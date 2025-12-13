import React from 'react';
import { Activity } from 'lucide-react';

const Header: React.FC = () => {
  return (
    <header className="w-full bg-white shadow-sm border-b border-slate-100 py-4 px-6 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-orange-500 p-2 rounded-lg text-white">
            <Activity size={24} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Apollo Hospitals</h1>
            <p className="text-xs text-slate-500 font-medium tracking-wide">WHERE EXCELLENCE MEETS COMPASSION</p>
          </div>
        </div>
        <nav className="hidden md:flex gap-6 text-sm font-medium text-slate-600">
          <a href="#" className="hover:text-orange-500 transition-colors">Find a Doctor</a>
          <a href="#" className="hover:text-orange-500 transition-colors">Book Appointment</a>
          <a href="#" className="hover:text-orange-500 transition-colors">Emergency</a>
        </nav>
      </div>
    </header>
  );
};

export default Header;