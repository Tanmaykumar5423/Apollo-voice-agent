import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { Mic, MicOff, Phone, PhoneOff, AlertCircle } from 'lucide-react';
import { 
  APOLLO_SYSTEM_INSTRUCTION, 
  MODEL_NAME, 
  VOICE_NAME,
  TOOLS
} from '../constants';
import { 
  base64ToUint8Array, 
  createPcmBlob, 
  decodeAudioData,
  playAudioCue
} from '../utils/audioUtils';
import AudioVisualizer from './AudioVisualizer';
import { ConnectionState } from '../types';

const VoiceAgent: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [bookingConfirmation, setBookingConfirmation] = useState<string | null>(null);
  
  // Refs for audio handling to avoid re-renders
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Playback queue cursor
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Live Session
  const activeSessionRef = useRef<{ close: () => void, sendRealtimeInput: (data: any) => void } | null>(null);

  // Initialize Audio Contexts
  const initAudioContexts = () => {
    // Input: 16kHz required for optimal Speech-to-Text in Gemini Live
    if (!inputContextRef.current) {
      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    }
    // Output: 24kHz is the standard rate from Gemini Live Text-to-Speech
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
    
    // Stop all scheduled output audio
    scheduledSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) { /* ignore already stopped */ }
    });
    scheduledSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  };

  const startSession = async () => {
    try {
      setConnectionState(ConnectionState.CONNECTING);
      setErrorMessage(null);
      setBookingConfirmation(null);
      
      initAudioContexts();
      const inputCtx = inputContextRef.current!;
      const outputCtx = outputContextRef.current!;

      // Resume contexts if suspended (browser autoplay policy)
      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      // Get Microphone with specific error handling
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err: any) {
        console.error("Microphone access error:", err);
        let msg = "Could not access microphone.";
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
             msg = "Microphone permission denied. Please allow access in browser settings.";
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
             msg = "No microphone found on your device.";
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
             msg = "Microphone is unavailable. Close other apps using it.";
        }
        throw new Error(msg);
      }
      streamRef.current = stream;

      // Setup Input Audio Pipeline
      const source = inputCtx.createMediaStreamSource(stream);
      inputSourceRef.current = source;
      
      const analyser = inputCtx.createAnalyser();
      analyser.fftSize = 256;
      inputAnalyserRef.current = analyser;
      
      // Use ScriptProcessor for PCM extraction
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(inputCtx.destination); 

      // Setup Output Analyser
      const outAnalyser = outputCtx.createAnalyser();
      outAnalyser.fftSize = 256;
      outputAnalyserRef.current = outAnalyser;
      outAnalyser.connect(outputCtx.destination);

      // Initialize Gemini Client
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } },
          },
          systemInstruction: APOLLO_SYSTEM_INSTRUCTION,
          tools: TOOLS
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Live Session Opened');
            setConnectionState(ConnectionState.CONNECTED);
            playAudioCue(outputCtx, 'start');
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Tool Calls
            if (message.toolCall) {
                console.log("Tool Call received:", message.toolCall);
                playAudioCue(outputCtx, 'processing');
                
                const functionResponses = message.toolCall.functionCalls.map(fc => {
                  let result = {};
                  if (fc.name === 'bookAppointment') {
                     const bookingId = "APO-" + Math.floor(1000 + Math.random() * 9000);
                     console.log(`Booking confirmed for ${fc.args['patientName']} with ID ${bookingId}`);
                     // Update UI to show success
                     setBookingConfirmation(`Appointment Confirmed! ID: ${bookingId}`);
                     
                     result = { 
                       bookingId: bookingId,
                       status: "confirmed", 
                       message: "Appointment scheduled successfully." 
                     };
                  }
                  return {
                    id: fc.id,
                    name: fc.name,
                    response: { result }
                  };
                });

                sessionPromise.then(session => {
                    session.sendToolResponse({ functionResponses });
                });
            }

            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              const pcmData = base64ToUint8Array(base64Audio);
              const audioBuffer = await decodeAudioData(pcmData, outputCtx, 24000, 1);
              
              // Schedule playback
              const now = outputCtx.currentTime;
              const startTime = Math.max(now, nextStartTimeRef.current);
              
              const sourceNode = outputCtx.createBufferSource();
              sourceNode.buffer = audioBuffer;
              sourceNode.connect(outAnalyser);
              
              sourceNode.start(startTime);
              nextStartTimeRef.current = startTime + audioBuffer.duration;
              
              scheduledSourcesRef.current.add(sourceNode);
              sourceNode.onended = () => {
                scheduledSourcesRef.current.delete(sourceNode);
              };
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
                console.log('Model interrupted');
                scheduledSourcesRef.current.forEach(src => {
                    try { src.stop(); } catch (e) {}
                });
                scheduledSourcesRef.current.clear();
                nextStartTimeRef.current = outputCtx.currentTime;
            }
          },
          onclose: (e) => {
            console.log('Session Closed', e);
            if (connectionState === ConnectionState.CONNECTED) {
               setConnectionState(ConnectionState.DISCONNECTED);
            }
          },
          onerror: (e) => {
            console.error('Session Error', e);
            setErrorMessage("Connection interrupted. Please check your network and try again.");
            setConnectionState(ConnectionState.ERROR);
            stopAudio();
          }
        }
      });
      
      // Catch initial connection failures (e.g. invalid API key, network issues)
      sessionPromise.catch(err => {
         console.error("Connection failed:", err);
         setErrorMessage("Unable to connect to Apollo AI service. Please check your connection.");
         setConnectionState(ConnectionState.ERROR);
         stopAudio();
      });

      // Hook up audio processor to session input
      processor.onaudioprocess = (e) => {
        if (isMuted) return; 

        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createPcmBlob(inputData);
        
        sessionPromise.then(session => {
            activeSessionRef.current = session;
            session.sendRealtimeInput({ media: pcmBlob });
        });
      };

    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Failed to initialize voice session.");
      setConnectionState(ConnectionState.ERROR);
      stopAudio();
    }
  };

  const endSession = useCallback(() => {
    // If we have an active session ref, we can assume we were connected or connecting.
    // Play stop cue if we have a valid context.
    if (activeSessionRef.current && outputContextRef.current) {
        playAudioCue(outputContextRef.current, 'stop');
    }

    stopAudio();
    if (activeSessionRef.current) {
        // @ts-ignore
        activeSessionRef.current.close?.(); 
        activeSessionRef.current = null;
    }
    setConnectionState(ConnectionState.DISCONNECTED);
  }, []);

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  useEffect(() => {
    return () => {
      endSession();
    };
  }, [endSession]);

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-3xl mx-auto p-6">
      
      {/* Status Card */}
      <div className="w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100">
        <div className="bg-slate-50 p-6 text-center border-b border-slate-100">
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Apollo Assist</h2>
          <p className="text-slate-500 max-w-lg mx-auto">
            Schedule appointments, check insurance, or ask about our services. 
            Speak naturally—I am here to help.
          </p>
        </div>

        <div className="p-8 flex flex-col items-center gap-8 min-h-[400px] justify-center relative bg-gradient-to-b from-white to-slate-50">
          
          {/* Visualizer Area */}
          <div className="w-full relative flex items-center justify-center">
            {isConnected ? (
              <div className="w-full space-y-4">
                 <div className="flex justify-between items-center px-4">
                     <span className="text-xs font-semibold text-teal-600 uppercase tracking-wider">Input (Mic)</span>
                     <span className="text-xs font-semibold text-orange-600 uppercase tracking-wider">Output (Agent)</span>
                 </div>
                 <div className="relative">
                    <AudioVisualizer analyser={outputAnalyserRef.current} isActive={isConnected} color="#ea580c" />
                    <div className="absolute top-0 left-0 w-full opacity-50 mix-blend-multiply">
                        <AudioVisualizer analyser={inputAnalyserRef.current} isActive={isConnected && !isMuted} color="#0d9488" />
                    </div>
                 </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 w-full border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                 {isConnecting ? (
                    <div className="animate-pulse flex flex-col items-center">
                        <div className="h-4 w-4 bg-teal-500 rounded-full mb-2 animate-bounce"></div>
                        <span className="text-slate-400 font-medium">Connecting to Apollo Secure Server...</span>
                    </div>
                 ) : (
                    <div className="text-slate-400 font-medium flex flex-col items-center gap-2">
                        <div className="p-4 bg-white rounded-full shadow-sm">
                            <ActivityIcon />
                        </div>
                        <span>Ready to assist you</span>
                    </div>
                 )}
              </div>
            )}
          </div>

          {/* Messages/Feedback */}
          {errorMessage && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 px-4 py-2 rounded-lg text-sm animate-fade-in text-center max-w-lg">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {bookingConfirmation && (
            <div className="flex items-center gap-2 text-green-700 bg-green-50 px-6 py-3 rounded-xl text-md font-semibold border border-green-200 animate-fade-in shadow-sm">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
              <span>{bookingConfirmation}</span>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-6 mt-4">
            {!isConnected ? (
              <button
                onClick={startSession}
                disabled={isConnecting}
                className={`
                  flex items-center gap-3 px-8 py-4 rounded-full font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5
                  ${isConnecting 
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                    : 'bg-gradient-to-r from-teal-600 to-teal-500 text-white hover:from-teal-500 hover:to-teal-400'}
                `}
              >
                <Phone size={24} />
                {isConnecting ? 'Connecting...' : 'Start Conversation'}
              </button>
            ) : (
              <>
                <button
                  onClick={toggleMute}
                  className={`
                    p-5 rounded-full shadow-lg transition-all border-2 
                    ${isMuted 
                      ? 'bg-red-50 border-red-200 text-red-500 hover:bg-red-100' 
                      : 'bg-white border-slate-100 text-slate-700 hover:bg-slate-50'}
                  `}
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                </button>

                <button
                  onClick={endSession}
                  className="px-8 py-4 bg-red-500 hover:bg-red-600 text-white rounded-full font-bold text-lg shadow-lg hover:shadow-xl transition-all flex items-center gap-3"
                >
                  <PhoneOff size={24} />
                  End Call
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* Information Cards */}
      <div className="grid md:grid-cols-3 gap-4 w-full mt-8">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
           <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-3 font-bold">1</div>
           <h3 className="font-semibold text-slate-800 mb-1">Book Appointments</h3>
           <p className="text-sm text-slate-500">Find the right specialist and schedule a time that works for you.</p>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
           <div className="w-8 h-8 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mb-3 font-bold">2</div>
           <h3 className="font-semibold text-slate-800 mb-1">Check Insurance</h3>
           <p className="text-sm text-slate-500">Instantly verify if your provider is accepted at our clinics.</p>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
           <div className="w-8 h-8 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mb-3 font-bold">3</div>
           <h3 className="font-semibold text-slate-800 mb-1">General Inquiries</h3>
           <p className="text-sm text-slate-500">Ask about visiting hours, parking, or specific medical procedures.</p>
        </div>
      </div>

    </div>
  );
};

const ActivityIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-slate-300">
     <path d="M22 12H18L15 21L9 3L6 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export default VoiceAgent;