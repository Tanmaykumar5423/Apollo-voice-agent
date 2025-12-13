import { Type } from '@google/genai';

export const DOCTORS_DATA = [
  { id: 'D-3001', name: 'Dr. Arun Rajan', specialty: 'Cardiology (Heart)', location: 'Chennai (Main Rd)', availability: 'Mon-Wed 09:00-13:00' },
  { id: 'D-3002', name: 'Dr. Neha Mehta', specialty: 'Pediatrics (Child Specialist)', location: 'Bangalore (Whitefield)', availability: 'Tue, Thu 10:00-16:00' },
  { id: 'D-3003', name: 'Dr. Suresh Kumar', specialty: 'ENT (Ear, Nose, Throat)', location: 'Hyderabad', availability: 'Fri 09:00-12:00' },
  { id: 'D-3004', name: 'Dr. Priya Nair', specialty: 'Neurology (Brain)', location: 'Mumbai', availability: 'Mon, Thu 14:00-18:00' }
];

export const MOCK_APPOINTMENTS = [
  { id: 'APP-1282', patientName: 'Kavya Rao', doctor: 'Dr. Priya Nair', time: '2025-12-20 at 10:30 AM', status: 'Confirmed' },
  { id: 'APP-1502', patientName: 'Vikram Patel', doctor: 'Dr. Suresh Kumar', time: '2025-12-18 at 09:00 AM', status: 'Confirmed' },
  { id: 'APP-1272', patientName: 'Rohit Singh', doctor: 'Dr. Arun Rajan', time: 'Tomorrow at 5:00 PM', status: 'Confirmed' }
];

export const MOCK_BILLS = [
  { id: 'INV-517', amount: 'INR 3,450.00', details: 'Consultation: INR 1500; Tests: INR 1500; Taxes: INR 450' },
  { id: 'INV-523', amount: 'INR 1,200.00', details: 'Consultation: INR 1000; Taxes: INR 200' }
];

export const APOLLO_SYSTEM_INSTRUCTION = `
You are "Apollo Assist", the Voice AI Assistant for Apollo Hospitals. 
Your persona is professional, warm, caring, and knowledgeable, with a gentle Indian English phrasing (e.g., using polite forms like "Ji" occasionally).

YOUR KNOWLEDGE BASE:

DOCTORS DIRECTORY:
${DOCTORS_DATA.map(d => `- ${d.name} (${d.specialty}) in ${d.location}. Available: ${d.availability}`).join('\n')}

SERVICES:
- General appointments, Specialist consultations.
- Opening Hours: Mon-Sat 8:00 AM to 8:00 PM. Emergency services are 24/7.
- Insurance: Acceptance of major Indian/International providers.

LAB REPORTS TURNAROUND:
- CBC (Complete Blood Count): 24 hours.
- Thyroid Profile: 24-48 hours.
- HbA1c (Sugar): 24 hours.
- Urinalysis: 4-6 hours.

CRITICAL INSTRUCTIONS:
1. **Emergency**: If the user mentions chest pain, breathlessness, or severe trauma, IMMEDIATELY advise them to call emergency services. Do not book a standard slot.
2. **Doctor Search**: Use \`checkAvailability\` to find specialists.
3. **Booking**: Collect details, CONFIRM with user, then use \`bookAppointment\`.
4. **Existing Appointments**: Use \`checkAppointmentStatus\`, \`cancelAppointment\`, or \`rescheduleAppointment\` when requested.
5. **Billing**: Use \`checkBill\` to look up invoice details.

TONE:
- Concise, empathetic, spoken-word style.
- Assume current year is 2025.
`;

export const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';
export const VOICE_NAME = 'Kore'; 

export const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "checkAvailability",
        description: "Search for a doctor by name or specialty and check their availability.",
        parameters: {
          type: Type.OBJECT,
          properties: {
             query: { type: Type.STRING, description: "Doctor name or specialty (e.g. 'Cardiologist', 'Dr. Rajan')" },
             location: { type: Type.STRING, description: "Optional city or location filter" }
          },
          required: ["query"]
        }
      },
      {
        name: "bookAppointment",
        description: "Finalizes the appointment booking after user confirmation. Returns a booking ID.",
        parameters: {
          type: Type.OBJECT,
          properties: {
             patientName: { type: Type.STRING, description: "Name of the patient" },
             doctorOrSpecialty: { type: Type.STRING, description: "Doctor name or medical specialty" },
             appointmentDateTime: { type: Type.STRING, description: "Date and time of appointment" }
          },
          required: ["patientName", "doctorOrSpecialty", "appointmentDateTime"]
        }
      },
      {
        name: "checkAppointmentStatus",
        description: "Check the status of an existing appointment using the Booking ID.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                bookingId: { type: Type.STRING, description: "The appointment ID (e.g., APP-1234)" }
            },
            required: ["bookingId"]
        }
      },
      {
        name: "cancelAppointment",
        description: "Cancel an existing appointment.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                bookingId: { type: Type.STRING, description: "The appointment ID to cancel" }
            },
            required: ["bookingId"]
        }
      },
      {
        name: "rescheduleAppointment",
        description: "Reschedule an existing appointment to a new time.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                bookingId: { type: Type.STRING, description: "The appointment ID to reschedule" },
                newDateTime: { type: Type.STRING, description: "The new requested date and time" }
            },
            required: ["bookingId", "newDateTime"]
        }
      },
      {
        name: "checkBill",
        description: "Check the total amount and details of a specific invoice/bill.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                invoiceId: { type: Type.STRING, description: "The invoice ID (e.g., INV-517)" }
            },
            required: ["invoiceId"]
        }
      }
    ]
  }
];