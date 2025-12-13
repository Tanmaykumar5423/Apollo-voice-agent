import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { Mic, MicOff, Phone, PhoneOff, AlertCircle, CalendarCheck, Loader2, UserRoundSearch, Stethoscope, MapPin, Clock, FileText, Ban, CalendarClock } from 'lucide-react';
import { 
  APOLLO_SYSTEM_INSTRUCTION, 
  MODEL_NAME, 
  TOOLS,
  DOCTORS_DATA,
  MOCK_APPOINTMENTS,
  MOCK_BILLS
} from '../constants';
import { 
  base64ToUint8Array, 
  createPcmBlob, 
  decodeAudioData 
} from '../utils/audioUtils';
import AudioVisualizer from './AudioVisualizer';
import { ConnectionState } from '../types';

interface InfoCardData {
  type: 'booking' | 'status' | 'bill' | 'cancellation' | 'reschedule';
  title: string;
  data: Record<string, string>;
}

const VoiceAgent: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  
  // UI States
  const [infoCard, setInfoCard] = useState<InfoCardData | null>(null);
  const [activeDoctor, setActiveDoctor] = useState<typeof DOCTORS_DATA[0] | null>(null);
  
  // Refs for audio handling
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Playback queue cursor
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Live Session
  const activeSessionRef = useRef<{ close: () => void, sendRealtimeInput: (data: any) => void, sendToolResponse: (data: any) => void } | null>(null);

  const initAudioContexts = () => {
    if (!inputContextRef.current) {
      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (!outputContextRef.current) {
      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
  };

  const stopAudio = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    scheduledSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { /* ignore */ }
    });
    scheduledSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  };

  const startSession = async () => {
    try {
      if (connectionState === ConnectionState.CONNECTING || connectionState === ConnectionState.CONNECTED) return;

      setConnectionState(ConnectionState.CONNECTING);
      setErrorMessage(null);
      setInfoCard(null);
      setActiveDoctor(null);
      
      initAudioContexts();
      const inputCtx = inputContextRef.current!;
      const outputCtx = outputContextRef.current!;

      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      if (!outputAnalyserRef.current) {
        outputAnalyserRef.current = outputCtx.createAnalyser();
        outputAnalyserRef.current.fftSize = 256;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
        });
        streamRef.current = stream;
      } catch (err: any) {
        setErrorMessage("Microphone access denied or not found.");
        setConnectionState(ConnectionState.ERROR);
        return;
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          systemInstruction: APOLLO_SYSTEM_INSTRUCTION,
          tools: TOOLS,
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
        callbacks: {
          onopen: async () => {
            console.log("Session opened");
            setConnectionState(ConnectionState.CONNECTED);
            
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData, inputCtx.sampleRate);
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
            inputSourceRef.current = source;
            processorRef.current = processor;
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              const responses: any[] = [];
              for (const fc of message.toolCall.functionCalls) {
                
                // 1. Check Availability
                if (fc.name === 'checkAvailability') {
                  const { query } = fc.args as any;
                  const searchStr = query.toLowerCase();
                  const found = DOCTORS_DATA.find(d => 
                    d.name.toLowerCase().includes(searchStr) || 
                    d.specialty.toLowerCase().includes(searchStr)
                  );

                  let result = "No matching doctor found.";
                  if (found) {
                    result = `Found: ${found.name} (${found.specialty}) in ${found.location}. Availability: ${found.availability}`;
                    setActiveDoctor(found);
                    setInfoCard(null); // Clear other cards
                  } else {
                    setActiveDoctor(null);
                  }
                  responses.push({ id: fc.id, name: fc.name, response: { result } });
                }
                
                // 2. Book Appointment
                else if (fc.name === 'bookAppointment') {
                  const { patientName, doctorOrSpecialty, appointmentDateTime } = fc.args as any;
                  const bookingId = "AP-" + Math.floor(100000 + Math.random() * 900000);
                  
                  setInfoCard({
                    type: 'booking',
                    title: 'Appointment Confirmed',
                    data: {
                      'Patient': patientName,
                      'Doctor': doctorOrSpecialty,
                      'Time': appointmentDateTime,
                      'Booking ID': bookingId
                    }
                  });
                  setActiveDoctor(null);
                  responses.push({ id: fc.id, name: fc.name, response: { result: `Success. Booking ID: ${bookingId}.` } });
                }

                // 3. Check Appointment Status
                else if (fc.name === 'checkAppointmentStatus') {
                   const { bookingId } = fc.args as any;
                   const apt = MOCK_APPOINTMENTS.find(a => a.id === bookingId);
                   
                   let result = "Appointment not found.";
                   if (apt) {
                      result = `Appointment ${apt.id} is ${apt.status} with ${apt.doctor} at ${apt.time}.`;
                      setInfoCard({
                        type: 'status',
                        title: 'Appointment Status',
                        data: {
                          'Status': apt.status,
                          'Patient': apt.patientName,
                          'Doctor': apt.doctor,
                          'Time': apt.time
                        }
                      });
                      setActiveDoctor(null);
                   }
                   responses.push({ id: fc.id, name: fc.name, response: { result } });
                }

                // 4. Cancel Appointment
                else if (fc.name === 'cancelAppointment') {
                   const { bookingId } = fc.args as any;
                   setInfoCard({
                     type: 'cancellation',
                     title: 'Appointment Cancelled',
                     data: { 'Booking ID': bookingId, 'Status': 'Cancelled' }
                   });
                   responses.push({ id: fc.id, name: fc.name, response: { result: `Appointment ${bookingId} cancelled.` } });
                }

                // 5. Reschedule Appointment
                else if (fc.name === 'rescheduleAppointment') {
                   const { bookingId, newDateTime } = fc.args as any;
                   setInfoCard({
                     type: 'reschedule',
                     title: 'Appointment Rescheduled',
                     data: { 'Booking ID': bookingId, 'New Time': newDateTime, 'Status': 'Confirmed' }
                   });
                   responses.push({ id: fc.id, name: fc.name, response: { result: `Appointment ${bookingId} rescheduled to ${newDateTime}.` } });
                }

                // 6. Check Bill
                else if (fc.name === 'checkBill') {
                    const { invoiceId } = fc.args as any;
                    const bill = MOCK_BILLS.find(b => b.id === invoiceId);
                    
                    let result = "Invoice not found.";
                    if (bill) {
                        result = `Invoice ${bill.id} total is ${bill.amount}. Details: ${bill.details}`;
                        setInfoCard({
                            type: 'bill',
                            title: 'Invoice Details',
                            data: {
                                'Invoice ID': bill.id,
                                'Amount': bill.amount,
                                'Breakdown': bill.details
                            }
                        });
                        setActiveDoctor(null);
                    }
                    responses.push({ id: fc.id, name: fc.name, response: { result } });
                }
              }
              
              if (responses.length > 0) {
                 const session = await sessionPromise;
                 session.sendToolResponse({ functionResponses: responses });
              }
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              try {
                const audioBuffer = await decodeAudioData(base64ToUint8Array(base64Audio), outputCtx);
                const currentTime = outputCtx.currentTime;
                let startTime = nextStartTimeRef.current < currentTime ? currentTime : nextStartTimeRef.current;
                
                const source = outputCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputAnalyserRef.current!);
                outputAnalyserRef.current!.connect(outputCtx.destination);
                source.start(startTime);
                
                nextStartTimeRef.current = startTime + audioBuffer.duration;
                scheduledSourcesRef.current.add(source);
                source.onended = () => scheduledSourcesRef.current.delete(source);
              } catch (e) { console.error(e); }
            }
            
            if (message.serverContent?.interrupted) {
               scheduledSourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
               scheduledSourcesRef.current.clear();
               nextStartTimeRef.current = outputCtx.currentTime;
            }
          },
          onclose: () => { setConnectionState(ConnectionState.DISCONNECTED); stopAudio(); },
          onerror: (err) => { setErrorMessage("Connection interrupted."); setConnectionState(ConnectionState.ERROR); stopAudio(); }
        }
      });
      
      const session = await sessionPromise;
      activeSessionRef.current = session;

    } catch (error: any) {
      setErrorMessage("Failed to connect to Apollo Assist.");
      setConnectionState(ConnectionState.ERROR);
      stopAudio();
    }
  };

  const endSession = () => {
    if (activeSessionRef.current) {
      activeSessionRef.current.close();
      activeSessionRef.current = null;
    }
    stopAudio();
    setConnectionState(ConnectionState.DISCONNECTED);
  };

  const toggleMute = () => setIsMuted(!isMuted);

  useEffect(() => {
    return () => {
      endSession();
      if (inputContextRef.current?.state !== 'closed') inputContextRef.current?.close();
      if (outputContextRef.current?.state !== 'closed') outputContextRef.current?.close();
    };
  }, []);

  const getCardIcon = (type: string) => {
      switch(type) {
          case 'booking': return <CalendarCheck size={24} />;
          case 'bill': return <FileText size={24} />;
          case 'cancellation': return <Ban size={24} />;
          case 'reschedule': return <CalendarClock size={24} />;
          default: return <AlertCircle size={24} />;
      }
  };

  const getCardColor = (type: string) => {
      switch(type) {
          case 'booking': return 'bg-teal-600';
          case 'bill': return 'bg-indigo-600';
          case 'cancellation': return 'bg-red-500';
          case 'reschedule': return 'bg-orange-500';
          default: return 'bg-blue-600';
      }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-2xl gap-6">
      {/* Visualizer Card */}
      <div className="relative w-full">
        <div className="absolute inset-0 bg-gradient-to-r from-teal-500/20 to-blue-500/20 rounded-2xl blur-xl" />
        <div className="relative bg-white/80 backdrop-blur-md rounded-2xl p-6 shadow-xl border border-white/50">
          <div className="flex items-center justify-between mb-4">
             <div className="flex items-center gap-2">
               <span className={`w-3 h-3 rounded-full ${connectionState === ConnectionState.CONNECTED ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
               <span className="text-sm font-semibold text-slate-600">
                 {connectionState === ConnectionState.CONNECTED ? 'Apollo Assist Active' : 'Offline'}
               </span>
             </div>
             {connectionState === ConnectionState.CONNECTED && (
               <div className="text-xs text-slate-400 font-mono">LIVE 24kHz</div>
             )}
          </div>
          
          <AudioVisualizer 
            analyser={outputAnalyserRef.current} 
            isActive={connectionState === ConnectionState.CONNECTED} 
            color="#0f766e" 
          />

          <div className="flex justify-center items-center gap-6 mt-6">
             {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
               <button 
                 onClick={startSession}
                 className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white rounded-full font-bold shadow-lg shadow-orange-500/30 transition-all transform hover:scale-105"
               >
                 <Phone size={20} />
                 Start Consultation
               </button>
             ) : (
               <>
                 <button 
                   onClick={toggleMute}
                   className={`p-4 rounded-full transition-all ${isMuted ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                 >
                   {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                 </button>
                 <button 
                   onClick={endSession}
                   className="p-4 rounded-full bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/30 transition-all transform hover:scale-105"
                 >
                   <PhoneOff size={24} />
                 </button>
               </>
             )}
          </div>
        </div>
      </div>

      {/* Doctor Profile Card */}
      {activeDoctor && !infoCard && (
        <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white rounded-xl shadow-md border border-slate-200 p-5 flex items-start gap-4">
            <div className="bg-blue-100 p-3 rounded-full text-blue-600">
              <UserRoundSearch size={32} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-slate-900">{activeDoctor.name}</h3>
              <div className="flex items-center gap-2 text-slate-600 text-sm mb-2">
                <Stethoscope size={14} />
                <span>{activeDoctor.specialty}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-slate-500">
                <div className="flex items-center gap-2">
                   <MapPin size={14} />
                   <span>{activeDoctor.location}</span>
                </div>
                <div className="flex items-center gap-2">
                   <Clock size={14} />
                   <span>{activeDoctor.availability}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* General Info Card (Booking, Status, Bill, Cancellation, Reschedule) */}
      {infoCard && (
        <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="bg-white rounded-xl shadow-lg border border-slate-100 overflow-hidden">
            <div className={`${getCardColor(infoCard.type)} px-6 py-4 flex items-center gap-3 text-white`}>
              {getCardIcon(infoCard.type)}
              <h3 className="font-bold text-lg">{infoCard.title}</h3>
            </div>
            <div className="p-6 grid gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(infoCard.data).map(([key, value]) => (
                    <div key={key}>
                        <p className="text-sm text-slate-500 mb-1">{key}</p>
                        <p className="font-medium text-slate-900">{value}</p>
                    </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="flex items-center gap-2 p-4 w-full bg-red-50 text-red-700 rounded-lg border border-red-100 animate-in fade-in">
          <AlertCircle size={20} />
          <p className="text-sm font-medium">{errorMessage}</p>
        </div>
      )}
      
      {connectionState === ConnectionState.CONNECTING && (
         <div className="text-slate-500 flex items-center gap-2 text-sm">
           <Loader2 size={16} className="animate-spin" />
           Connecting to secure medical line...
         </div>
      )}
    </div>
  );
};

export default VoiceAgent;