import React from 'react';
import Header from './components/Header';
import VoiceAgent from './components/VoiceAgent';

function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <Header />
      <main className="container mx-auto px-4 py-8 flex flex-col items-center">
        <VoiceAgent />
      </main>
      
      <footer className="w-full text-center py-6 text-slate-400 text-sm">
        <p>© {new Date().getFullYear()} Apollo Hospitals Enterprise Ltd. All Rights Reserved.</p>
      </footer>
    </div>
  );
}

export default App;
