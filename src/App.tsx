import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Phone, CheckCircle2, Copy, RefreshCw, Loader2, ShieldCheck, 
  Settings, LayoutDashboard, Zap, AlertTriangle, Smartphone, 
  Menu, X, Server, MessageSquare, Shield, Activity, User, Save, Cpu, Clock, LogOut,
  Terminal, Users, Hash
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'pairing' | 'features' | 'settings'>('overview');
  const [botStatus, setBotStatus] = useState<{ 
    connected: boolean; 
    sessionExists: boolean; 
    status?: 'disconnected' | 'connecting' | 'connected';
    memoryUsageMB?: number;
    uptimeSeconds?: number;
    user?: { id: string; name: string, profilePic?: string } | null;
    metrics?: { messagesProcessed: number, activeGroupsCount: number };
    logs?: { time: string, message: string, type: 'info' | 'warn' | 'error' | 'success' }[];
  }>({ connected: false, sessionExists: false });
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [localUptime, setLocalUptime] = useState(0);
  const [searchFeature, setSearchFeature] = useState('');

  // Config State
  const [config, setConfig] = useState<any>(null);
  const [configLoading, setConfigLoading] = useState(false);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (botStatus.uptimeSeconds !== undefined) {
      setLocalUptime(botStatus.uptimeSeconds);
    }
  }, [botStatus.uptimeSeconds]);

  useEffect(() => {
    const timer = setInterval(() => {
      setLocalUptime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab === 'settings') fetchConfig();
  }, [activeTab]);

  useEffect(() => {
    if (botStatus.connected && pairingCode) {
      setPairingCode(null);
      setActiveTab('overview');
    }
    // Block access to other tabs if not connected
    if (!botStatus.connected && activeTab !== 'pairing') {
      setActiveTab('pairing');
    }
  }, [botStatus.connected, pairingCode, activeTab]);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setBotStatus(data);
      }
    } catch (err: any) {
      console.error('Failed to fetch bot status:', err.message);
    }
  };

  const handleReconnect = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reconnect', { method: 'POST' });
      if (res.ok) fetchStatus();
    } catch (err) {
      console.error('Reconnect failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/logout', { method: 'POST' });
      if (res.ok) {
        setPairingCode(null);
        fetchStatus();
      }
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    setConfigLoading(true);
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      console.error('Failed to fetch config:', err);
    } finally {
      setConfigLoading(false);
    }
  };

  const saveConfig = async () => {
    setConfigLoading(true);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      alert('Config saved successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to save config');
    } finally {
      setConfigLoading(false);
    }
  };

  const updateToggle = async (field: 'autoRead' | 'autoTyping', value: boolean) => {
    const updatedConfig = { ...config, [field]: value };
    setConfig(updatedConfig);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
    } catch (err: any) {
      console.error('Failed to auto-save toggle:', err);
    }
  };

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) return;

    setLoading(true);
    setError(null);
    setPairingCode(null);

    try {
      const response = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneNumber }),
      });

      const data = await response.json();
      if (response.ok) {
        setPairingCode(data.code);
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Helpers
  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}j ${m}m ${s}d`;
  };

  // UI Components
  const NavItem = ({ id, icon: Icon, label }: { id: typeof activeTab, icon: any, label: string }) => (
    <button
      onClick={() => { setActiveTab(id); setIsMobileMenuOpen(false); }}
      className={`w-full flex items-center gap-3 px-3 py-3 font-serif text-xs md:text-sm transition-all duration-75 border-4 ${
        activeTab === id 
          ? 'bg-wa-accent text-black border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -translate-y-1 -translate-x-1' 
          : 'bg-white text-black border-black hover:bg-gray-100 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:-translate-x-1'
      }`}
    >
      <Icon size={18} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <div className="flex h-[100dvh] font-sans text-black overflow-hidden relative selection:bg-wa-accent selection:text-black">
      
    <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white text-black border-b-4 border-black z-50 flex items-center px-4 w-[100vw]">
        {/* Logo */}
        <div className="w-8 h-8 flex items-center justify-center shrink-0 bg-wa-accent border-2 border-black z-10 relative">
          <Zap size={16} fill="black" />
        </div>
        
        {/* Marquee */}
        <div className="flex-1 overflow-hidden relative flex items-center h-full mask-image-gradient mx-3">
          <motion.div
            animate={{ x: ["0%", "-50%"] }}
            transition={{ repeat: Infinity, duration: 40, ease: "linear" }}
            className="whitespace-nowrap font-marquee font-bold text-sm tracking-tight inline-flex"
          >
            <span className="inline-block px-4">Jalankan bot WhatsApp dengan mudah via website. Bangun otomatisasi cerdas dalam hitungan menit tanpa ribet teknis. Lengkap, aman, dan modern.</span>
            <span className="inline-block px-4">Jalankan bot WhatsApp dengan mudah via website. Bangun otomatisasi cerdas dalam hitungan menit tanpa ribet teknis. Lengkap, aman, dan modern.</span>
          </motion.div>
        </div>

        {/* Menu Button */}
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-black hover:bg-gray-200 border-2 border-transparent hover:border-black shrink-0">
          {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-40 w-[80vw] max-w-[280px] lg:w-72 bg-white border-r-4 border-black transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative flex flex-col`}>
        <div className="h-24 hidden lg:flex items-center px-4 md:px-8 border-b-4 border-black bg-[#facc15] text-black">
          <div className="flex items-center gap-3 md:gap-4 overflow-hidden w-full">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white flex items-center justify-center border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] shrink-0 z-10 relative">
              <Zap size={22} fill="black" />
            </div>
            <div className="flex-1 overflow-hidden relative flex items-center mask-image-gradient">
              <motion.div
                animate={{ x: ["0%", "-50%"] }}
                transition={{ repeat: Infinity, duration: 60, ease: "linear" }}
                className="whitespace-nowrap font-marquee font-bold text-sm tracking-widest uppercase inline-flex"
              >
                <span className="inline-block px-8">Jalankan bot WhatsApp dengan mudah via website. Bangun otomatisasi cerdas dalam hitungan menit tanpa ribet teknis. Lengkap, aman, dan modern.</span>
                <span className="inline-block px-8">Jalankan bot WhatsApp dengan mudah via website. Bangun otomatisasi cerdas dalam hitungan menit tanpa ribet teknis. Lengkap, aman, dan modern.</span>
              </motion.div>
            </div>
          </div>
        </div>

        <div className="flex-1 px-3 py-6 md:px-4 md:py-8 space-y-3 md:space-y-4 mt-16 lg:mt-0 font-serif text-black">
          
          {botStatus.connected ? (
            <>
              <NavItem id="overview" icon={LayoutDashboard} label="Ringkasan" />
              <NavItem id="features" icon={Shield} label="Fitur" />
              <NavItem id="settings" icon={Settings} label="Pengaturan" />
            </>
          ) : (
            <div className="px-3 py-4 text-xs font-bold bg-gray-200 text-black pixel-border border-dashed text-center break-words">
              Akses terkunci! Tautkan perangkat anda terlebih dahulu
            </div>
          )}
          
          <div className="pt-4 mt-4 border-t-4 border-black border-dashed">
            <NavItem id="pairing" icon={Smartphone} label="tautkan perangkat" />
          </div>
        </div>

        <div className="p-4 border-t-4 border-black bg-gray-100">
          <div className={`flex items-center gap-3 px-3 py-3 bg-white pixel-border pixel-shadow-sm`}>
            <div className={`w-3 h-3 md:w-4 md:h-4 shrink-0 border-2 border-black ${botStatus.connected ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500 shadow-[0_0_10px_#ef4444]'}`}></div>
            <div className="flex flex-col font-serif overflow-hidden">
              <span className="text-xs md:text-sm font-bold uppercase tracking-wider truncate">{botStatus.connected ? 'TERHUBUNG' : 'TERPUTUS'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden relative pt-16 lg:pt-0">
        <main className="w-full max-w-6xl mx-auto p-4 md:p-6 lg:p-10 relative z-10 min-h-full flex flex-col pt-6 md:pt-8 lg:pt-10">
          
          <AnimatePresence mode="wait">
            
            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && (
              <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6 md:space-y-8 w-full max-w-[100vw]">
                <div>
                  <h1 className="text-3xl md:text-4xl font-serif font-bold mb-2 uppercase text-black drop-shadow-[2px_2px_0px_#fff,4px_4px_0px_#000] break-words">DASHBOARD</h1>
                  <p className="text-sm md:text-xl font-bold bg-black text-white inline-block px-2 py-1">Statistik Sistem Real-time</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 text-black">
                  {/* Card 1: User Profile & Session */}
                  <div className="bg-white pixel-border pixel-shadow p-4 md:p-6 flex flex-col gap-4 md:gap-6 md:col-span-2 lg:col-span-1">
                    <div className="flex items-center gap-3 md:gap-4">
                      <div className="w-12 h-12 md:w-16 md:h-16 bg-gray-200 text-black pixel-border border-2 flex items-center justify-center shrink-0 overflow-hidden relative group">
                        {botStatus.user?.profilePic ? (
                          <img 
                            src={botStatus.user.profilePic} 
                            alt="Profile" 
                            referrerPolicy="no-referrer" 
                            className="w-full h-full object-cover" 
                            onError={(e) => {
                                // If image fails, fallback to icon
                                e.currentTarget.style.display = 'none';
                                const next = e.currentTarget.nextElementSibling as HTMLElement;
                                if (next) next.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div className={`${botStatus.user?.profilePic ? 'hidden' : 'flex'} w-full h-full items-center justify-center`}>
                           <User size={24} className="md:w-8 md:h-8" />
                        </div>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <h2 className="text-xl md:text-2xl font-bold truncate text-black">{botStatus.user?.name || 'Player 1'}</h2>
                        <div className="flex items-center gap-2 text-base md:text-lg mt-1 text-black">
                          <Phone size={14} className="shrink-0" />
                          <span className="truncate">{botStatus.user?.id ? '+' + botStatus.user.id.split('@')[0] : '+62...'}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-row gap-2 md:gap-4 mt-auto font-serif">
                      <button onClick={() => setActiveTab('settings')} className="pixel-button bg-blue-400 text-black p-2 flex justify-center text-lg md:text-xl item-center aspect-square shrink-0">
                        <Settings size={18} className="md:w-5 md:h-5" />
                      </button>
                      <button onClick={botStatus.connected ? handleLogout : () => setActiveTab('pairing')} disabled={loading} className="pixel-button flex-1 bg-red-400 text-white px-2 py-2 flex justify-center text-sm md:text-xl items-center gap-2 truncate">
                        {loading ? <Loader2 size={16} className="animate-spin" /> : botStatus.connected ? <><LogOut size={16} /><span className="truncate">LOGOUT</span></> : 'TAUTAN'}
                      </button>
                    </div>
                  </div>

                  {/* Card 2: Memory Usage */}
                  <div className="bg-[#facc15] pixel-border pixel-shadow p-4 md:p-6 flex flex-col gap-3 md:gap-4 relative">
                    <div className="flex items-center justify-between font-serif font-bold border-b-4 border-black pb-2 text-sm md:text-xl uppercase shrink-0">
                      <span className="truncate">MEMORI RAM</span>
                      <Cpu size={20} className="md:w-6 md:h-6 shrink-0" />
                    </div>
                    <div className="mt-auto flex justify-center items-baseline pt-2 md:pt-4">
                      <span className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">{botStatus.memoryUsageMB || 0}</span>
                      <span className="font-serif font-bold ml-1 md:ml-2 text-xl md:text-3xl">MB</span>
                    </div>
                  </div>
                  
                  {/* Card 3: Server Uptime */}
                  <div className="bg-[#4ade80] pixel-border pixel-shadow p-4 md:p-6 flex flex-col gap-3 md:gap-4 relative">
                    <div className="flex items-center justify-between font-serif font-bold border-b-4 border-black pb-2 text-sm md:text-xl uppercase shrink-0">
                      <span className="truncate">WAKTU AKTIF</span>
                      <Clock size={20} className="md:w-6 md:h-6 shrink-0" />
                    </div>
                    <div className="mt-auto flex justify-center pt-2 md:pt-4">
                      <span className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
                        {formatUptime(localUptime)}
                      </span>
                    </div>
                  </div>
                  {/* Card 4: Active Bots - NEW */}
                  <div className="bg-[#f472b6] pixel-border pixel-shadow p-4 md:p-6 flex flex-col gap-3 md:gap-4 relative overflow-hidden group">
                    <div className="flex items-center justify-between font-serif font-bold border-b-4 border-black pb-2 text-sm md:text-xl uppercase shrink-0">
                      <span className="truncate text-black">STABILITAS 24/7</span>
                      <ShieldCheck size={20} className="md:w-6 md:h-6 shrink-0 text-black" />
                    </div>
                    <div className="mt-auto flex flex-col items-center pt-2 md:pt-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 md:w-4 md:h-4 bg-green-500 shadow-[0_0_10px_#22c55e] border-2 border-black animate-pulse"></div>
                        <span className="text-xl sm:text-2xl md:text-3xl font-bold text-black">AKTIF</span>
                      </div>
                      <p className="text-[10px] md:text-xs font-bold text-black/60 uppercase mt-1">Anti-crash system running</p>
                    </div>
                    {/* Retro background pattern hint */}
                    <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:rotate-12 transition-transform">
                        <Zap size={80} fill="black" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mt-6 text-black">
                  {/* Network Stats */}
                  <div className="lg:col-span-1 flex flex-col gap-4 md:gap-6">
                    <div className="bg-white text-black pixel-border pixel-shadow p-4 md:p-6 flex items-center justify-between hover:bg-blue-100 transition-colors">
                      <div className="overflow-hidden">
                        <div className="font-serif text-sm md:text-lg font-bold uppercase mb-1 truncate">TOTAL GRUP</div>
                        <div className="text-3xl md:text-5xl font-bold truncate">{botStatus.metrics?.activeGroupsCount || 0}</div>
                      </div>
                      <div className="w-12 h-12 md:w-16 md:h-16 shrink-0 bg-blue-400 pixel-border border-2 flex items-center justify-center">
                        <Users size={24} className="md:w-8 md:h-8" />
                      </div>
                    </div>
                    
                    <div className="bg-white text-black pixel-border pixel-shadow p-4 md:p-6 flex items-center justify-between hover:bg-purple-100 transition-colors">
                      <div className="overflow-hidden">
                        <div className="font-serif text-sm md:text-lg font-bold uppercase mb-1 truncate">PESAN (XP)</div>
                        <div className="text-3xl md:text-5xl font-bold truncate">{botStatus.metrics?.messagesProcessed || 0}</div>
                      </div>
                      <div className="w-12 h-12 md:w-16 md:h-16 shrink-0 bg-purple-400 pixel-border border-2 flex items-center justify-center">
                        <Hash size={24} className="md:w-8 md:h-8" />
                      </div>
                    </div>
                  </div>

                  {/* Terminal / Live Console */}
                  <div className="lg:col-span-2 bg-[#0000aa] pixel-border pixel-shadow flex flex-col h-full min-h-[250px] md:min-h-[300px]">
                    <div className="h-8 md:h-10 border-b-4 border-black bg-[#c0c0c0] flex items-center px-2 md:px-4 justify-between shrink-0">
                      <div className="flex items-center gap-1 md:gap-2 font-serif text-black font-bold">
                        <Terminal size={14} className="md:w-[18px] md:h-[18px]" />
                        <span className="text-[10px] md:text-base uppercase tracking-wider truncate">LOG_SISTEM.EXE</span>
                      </div>
                      <div className="flex gap-1 md:gap-2">
                        <div className="w-3 h-3 md:w-4 md:h-4 bg-white border border-black flex items-center justify-center"><div className="w-1.5 h-0.5 bg-black"></div></div>
                        <div className="w-3 h-3 md:w-4 md:h-4 bg-white border border-black flex items-center justify-center"><div className="w-1.5 h-1.5 border border-black"></div></div>
                        <div className="w-3 h-3 md:w-4 md:h-4 bg-white border border-black flex items-center justify-center"><X size={10} className="text-black" /></div>
                      </div>
                    </div>
                    
                    <div className="p-3 md:p-4 flex-1 overflow-y-auto space-y-1 font-sans text-sm sm:text-base md:text-lg text-white">
                      <div className="mb-2 md:mb-4 text-xs md:text-lg">
                        BotBridge OS [Versi 1.0.0]<br/>
                        (c) 2026 Retro Systems. All rights reserved.
                      </div>
                      {botStatus.logs && botStatus.logs.length > 0 ? (
                        botStatus.logs.map((log, i) => (
                          <div key={i} className="flex gap-2 md:gap-3 hover:bg-blue-800 px-1 py-0.5 break-words items-start">
                            <span className="shrink-0 text-yellow-300 text-[10px] md:text-base mt-[2px] md:mt-0">[{log.time}]</span>
                            <span className={`break-words ${
                              log.type === 'error' ? 'text-red-400' :
                              log.type === 'warn' ? 'text-orange-400' :
                              log.type === 'success' ? 'text-green-400' : 'text-white'
                            }`}>
                              &gt; {log.message}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="text-gray-400 animate-pulse">&gt; MENUNGGU DATALOG..._</div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* PAIRING TAB */}
            {activeTab === 'pairing' && (
              <motion.div key="pairing" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="flex-1 flex flex-col justify-center w-full min-h-[85vh] lg:min-h-0 mx-auto w-full max-w-4xl px-2 sm:px-0">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-10 items-center">
                  <div className="flex flex-col justify-center text-center lg:text-left mt-4 lg:mt-0 px-2 lg:px-0">
                    <div className="flex flex-col items-center lg:items-start mb-4 md:mb-8 self-center lg:self-start gap-2">
                      <div className="inline-flex items-center gap-2 bg-[#facc15] text-black pixel-border border-b-[4px] border-r-[4px] md:border-b-[6px] md:border-r-[6px] px-3 py-1.5 md:px-4 md:py-2 font-serif font-bold text-sm md:text-lg uppercase">
                        <ShieldCheck size={16} className="md:w-5 md:h-5" />
                        Privasi Terjamin
                      </div>
                      <p className="text-xs md:text-sm font-bold bg-white text-black pixel-border px-2 py-1 shadow-[2px_2px_0px_#000] max-w-sm text-center lg:text-left">
                        Enkripsi end-to-end langsung dari protokol WhatsApp resmi.
                      </p>
                    </div>
                    
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold leading-tight mb-4 md:mb-6 uppercase text-black drop-shadow-[2px_2px_0px_#fff,4px_4px_0px_#000]">
                      TAUTKAN BOT <br/> <span className="text-blue-600">SEKARANG.</span>
                    </h1>
                    
                    <p className="text-sm sm:text-base md:text-xl lg:text-2xl font-bold bg-white text-black pixel-border p-3 md:p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      Masukkan nomor HP Anda untuk mendapat KODE TAUTAN 8-BIT rahasia.
                    </p>
                  </div>

                  <div className="bg-white pixel-border p-4 md:p-8 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-center w-full min-h-[350px] md:min-h-[450px]">
                    {pairingCode ? (
                      <div className="space-y-4 md:space-y-6 text-center w-full">
                        <div className="space-y-3 md:space-y-4">
                          <label className="font-serif text-sm md:text-xl font-bold uppercase block bg-black text-white py-1">
                            KODE RAHASIA
                          </label>
                          <div className="bg-gray-200 pixel-border p-4 sm:p-6 md:p-8 py-6 sm:py-8 md:py-10 flex flex-col items-center gap-4 md:gap-6 relative shadow-inner overflow-hidden">
                            <span className="font-serif text-4xl sm:text-5xl md:text-6xl tracking-widest md:tracking-[8px] text-black font-bold break-all whitespace-pre-wrap">
                              {pairingCode}
                            </span>
                            <button onClick={copyToClipboard} className="pixel-button bg-[#4ade80] text-black px-4 py-3 md:px-6 md:py-3 text-sm md:text-xl w-full flex items-center justify-center gap-2">
                              {copied ? <CheckCircle2 size={18} className="md:w-6 md:h-6" /> : <Copy size={18} className="md:w-6 md:h-6" />} 
                              {copied ? 'DISALIN!' : 'SALIN KODE'}
                            </button>
                          </div>
                        </div>

                        <div className="text-left space-y-2 md:space-y-3 bg-[#facc15] pixel-border p-3 md:p-4 text-black">
                          <span className="font-serif text-sm md:text-lg font-bold uppercase block border-b-4 border-black pb-2 mb-2 md:mb-4">
                            CARA PAKAI
                          </span>
                          <ol className="text-sm md:text-lg lg:text-xl space-y-2 font-bold pl-4 md:pl-6 list-decimal">
                            <li>Buka WA Ponsel &gt; Perangkat Tertaut</li>
                            <li>Pilih 'Tautkan Perangkat'</li>
                            <li>Pilih 'Tautkan dg Nomor Telepon'</li>
                          </ol>
                        </div>

                        <button onClick={() => { setPairingCode(null); setPhoneNumber(''); }} className="pixel-button bg-red-400 text-black px-3 py-3 md:py-4 mt-2 text-xs sm:text-sm md:text-lg w-full flex items-center justify-center gap-1 md:gap-2">
                          <RefreshCw size={16} className="shrink-0" /> BATAL & GANTI NOMOR PENGIRIM
                        </button>
                      </div>
                    ) : botStatus.sessionExists ? (
                      <div className="space-y-6 text-center py-6 md:py-8">
                        <div className={`w-16 h-16 md:w-24 md:h-24 border-4 border-black flex items-center justify-center mx-auto mb-4 md:mb-6 shadow-[4px_4px_0px_0px_#000] ${botStatus.connected ? 'bg-[#4ade80]' : 'bg-gray-200'}`}>
                          {botStatus.connected ? <CheckCircle2 size={32} className="md:w-12 md:h-12" /> : <Loader2 size={32} className="animate-spin md:w-12 md:h-12" />}
                        </div>
                        
                        <div className="bg-white pixel-border p-3 md:p-4 text-black">
                          <h2 className="text-xl md:text-2xl font-serif font-bold mb-1 md:mb-2 uppercase">
                            {botStatus.connected ? 'BERHASIL' : 'MEMUAT...'}
                          </h2>
                          <p className="text-sm md:text-lg font-bold">
                            {botStatus.connected 
                              ? 'Sistem WhatsApp Anda sukses masuk ke dalam jaringan bot.'
                              : 'Mencari sinyal dari server WhatsApp...'}
                          </p>
                        </div>

                        <div className="pt-6 md:pt-8 flex flex-col gap-3 md:gap-4">
                          {!botStatus.connected && (
                            <button onClick={handleReconnect} disabled={loading} className="pixel-button bg-[#facc15] text-black py-3 md:py-4 text-sm md:text-lg w-full flex justify-center items-center gap-2">
                              {loading ? <Loader2 size={16} className="animate-spin md:w-5 md:h-5" /> : <RefreshCw size={16} className="md:w-5 md:h-5" />} PAKSA HUBUNGKAN
                            </button>
                          )}
                          <button onClick={handleLogout} disabled={loading} className="pixel-button bg-red-400 text-white py-3 md:py-4 text-sm md:text-lg w-full">
                            HANCURKAN SESI
                          </button>
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handlePair} className="space-y-6 md:space-y-8 w-full">
                        <div className="bg-black text-white p-3 md:p-4 pixel-border">
                          <h2 className="text-lg md:text-2xl font-serif font-bold uppercase mb-1 md:mb-2">TARGET NOMOR</h2>
                          <p className="text-sm md:text-lg">Masukkan nomor bot untuk diinjeksi ke sistem WhatsApp.</p>
                        </div>
                        
                        <div className="space-y-4 md:space-y-6">
                          <div className="relative">
                            <Phone className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 md:w-6 md:h-6" />
                            <input
                              type="tel"
                              value={phoneNumber}
                              onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9]/g, ''))}
                              placeholder="cth: 628123456"
                              className="w-full bg-white text-black placeholder:text-gray-500 border-4 border-black p-3 pl-10 md:p-4 md:pl-14 text-lg sm:text-xl md:text-2xl font-bold outline-none focus:bg-yellow-100 transition-colors shadow-[4px_4px_0px_0px_#000]"
                              required
                              disabled={loading}
                            />
                          </div>
                          
                          {error && (
                            <div className="flex items-start gap-2 md:gap-4 text-black bg-red-400 pixel-border p-3 md:p-4 text-sm md:text-lg font-bold shadow-[4px_4px_0px_0px_#000]">
                              <AlertTriangle size={20} className="shrink-0 mt-0.5 md:w-6 md:h-6" />
                              <p>{error}</p>
                            </div>
                          )}
                        </div>

                        <button
                          type="submit"
                          disabled={loading || !phoneNumber}
                          className="pixel-button bg-[#3b82f6] text-white py-3 md:py-4 text-lg md:text-2xl w-full flex items-center justify-center gap-2 md:gap-3"
                        >
                          {loading ? <Loader2 size={20} className="animate-spin md:w-6 md:h-6" /> : 'GET PAIRING CODE'}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* FEATURES TAB */}
            {activeTab === 'features' && (
              <motion.div key="features" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6 md:space-y-8 w-full">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h1 className="text-3xl md:text-4xl font-serif font-bold mb-2 uppercase drop-shadow-[2px_2px_0px_#fff,4px_4px_0px_#000] break-words">DAFTAR FITUR</h1>
                    <p className="text-sm md:text-xl font-bold bg-black text-white inline-block px-2 py-1">Kumpulan fitur otomatisasi bot.</p>
                  </div>
                  
                  {/* Search Input */}
                  <div className="relative w-full md:w-80">
                    <input
                      type="text"
                      placeholder="Cari fitur... (cth: anti)"
                      value={searchFeature}
                      onChange={(e) => setSearchFeature(e.target.value)}
                      className="w-full bg-white pixel-border p-3 pl-10 md:p-4 md:pl-12 text-sm md:text-lg font-bold placeholder:text-gray-400 focus:outline-none focus:ring-0"
                    />
                    <div className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
                      <LayoutDashboard size={20} className="md:w-6 md:h-6" />
                    </div>
                    {searchFeature && (
                      <button 
                        onClick={() => setSearchFeature('')}
                        className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 text-black hover:scale-110 transition-transform"
                      >
                        <X size={20} className="md:w-6 md:h-6" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {[
                    { title: "Anti-Link All", cmd: ".antilinkall", desc: "Tebas semua URL liar secara global.", color: "bg-red-400" },
                    { title: "Anti-Link WA", cmd: ".antilinkgc", desc: "Blokir link grup/kontak/saluran WA.", color: "bg-orange-400" },
                    { title: "Anti-Media", cmd: ".antimedia", desc: "Larang peredaran foto & video.", color: "bg-[#facc15]" },
                    { title: "Anti-Doc", cmd: ".antidocument", desc: "Hancurkan file dokumen berbahaya (APK/dll).", color: "bg-[#4ade80]" },
                    { title: "Anti-Toxic", cmd: ".antitoxic", desc: "Sistem filter kata kotor otomatis.", color: "bg-purple-400" },
                    { title: "Anti-Bot", cmd: ".antibot", desc: "Deteksi dan kick bot palsu.", color: "bg-blue-400" },
                    { title: "Anti-Remove", cmd: ".antiremove", desc: "Forward ulang pesan yang telah dihapus.", color: "bg-indigo-400" },
                    { title: "Anti-Sticker", cmd: ".antisticker", desc: "Larang penggunaan sticker di grup.", color: "bg-yellow-400" },
                    { title: "Anti-Tag SW", cmd: ".antitagsw", desc: "Hapus pesan yang tag status di grup.", color: "bg-orange-200" },
                    { title: "Auto DL", cmd: ".autodl", desc: "Auto download link TikTok/IG/FB/YT/dll.", color: "bg-green-300" },
                    { title: "Auto Forward", cmd: ".autoforward", desc: "Forward otomatis semua pesan ke grup target.", color: "bg-lime-400" },
                    { title: "Auto Media", cmd: ".automedia", desc: "Otomatis konversi sticker menjadi gambar.", color: "bg-amber-300" },
                    { title: "Auto Read", cmd: "Dashboard", desc: "Otomatis centang biru saat pesan masuk (Aktifkan di Dashboard).", color: "bg-sky-400" },
                    { title: "Auto Typing", cmd: "Dashboard", desc: "Otomatis status sedang mengetik (Aktifkan di Dashboard).", color: "bg-zinc-400" },
                    { title: "Absensi", cmd: ".absen", desc: "Buka sesi absen (mulai/hadir/cek/hapus).", color: "bg-pink-400" },
                    { title: "Join Request", cmd: ".acc", desc: "Kelola permintaan join grup (list/approve/reject).", color: "bg-teal-400" },
                    { title: "Add Member", cmd: ".add", desc: "Tambah member ke grup via nomor/link.", color: "bg-cyan-400" },
                    { title: "Sticker Cmd", cmd: ".stickercmd", desc: "Jadikan sticker sebagai shortcut command.", color: "bg-rose-400" },
                    { title: "AFK Mode", cmd: ".afk", desc: "Mode perisai saat kamu pergi.", color: "bg-orange-300" },
                    { title: "Ping", cmd: ".ping", desc: "Cek respon bot.", color: "bg-gray-400" }
                  ].filter(f => 
                    f.title.toLowerCase().includes(searchFeature.toLowerCase()) || 
                    f.cmd.toLowerCase().includes(searchFeature.toLowerCase()) ||
                    f.desc.toLowerCase().includes(searchFeature.toLowerCase())
                  ).map((f, i) => (
                    <div key={i} className={`${f.color} pixel-border pixel-shadow p-4 md:p-6 flex flex-col gap-3 md:gap-4 hover:-translate-y-1 hover:-translate-x-1 md:hover:-translate-y-2 md:hover:-translate-x-2 md:hover:shadow-[12px_12px_0px_0px_#000] transition-all`}>
                      <div className="flex items-center justify-between border-b-4 border-black pb-2 bg-white/50 px-2 rounded-sm mx-[-8px] mt-[-8px]">
                        <h3 className="font-serif font-bold text-lg md:text-xl uppercase truncate text-black">{f.title}</h3>
                        <ShieldCheck size={20} className="md:w-6 md:h-6 shrink-0 ml-2 text-black" />
                      </div>
                      <p className="text-sm sm:text-base md:text-xl font-bold text-black flex-1 bg-white/80 p-2 border-2 border-black break-words">{f.desc}</p>
                      <div className="mt-2 bg-black text-green-400 font-sans text-base md:text-xl p-2 pixel-border break-all">
                        &gt; {f.cmd}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* SETTINGS TAB */}
            {activeTab === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6 md:space-y-8 max-w-3xl mx-auto w-full">
                <div>
                  <h1 className="text-3xl md:text-4xl font-serif font-bold mb-2 uppercase drop-shadow-[2px_2px_0px_#fff,4px_4px_0px_#000] break-words">PENGATURAN MESIN</h1>
                  <p className="text-sm md:text-xl font-bold bg-black text-white inline-block px-2 py-1">Tweak modifikasi inti sistem bot.</p>
                </div>
                
                {configLoading && !config ? (
                  <div className="flex items-center justify-center py-10 md:py-20 bg-white pixel-border shadow-[4px_4px_0px_0px_#000] md:shadow-[8px_8px_0px_0px_#000]">
                    <Loader2 size={32} className="animate-spin text-black md:w-12 md:h-12" />
                  </div>
                ) : (
                  <div className="bg-white text-black pixel-border shadow-[4px_4px_0px_0px_#000] md:shadow-[8px_8px_0px_0px_#000] w-full flex flex-col">
                    <div className="p-4 md:p-8 space-y-6 md:space-y-8 w-full">
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                        <div className={`p-4 md:p-6 pixel-border transition-all ${config?.autoRead ? 'bg-[#4ade80] shadow-[inset_4px_4px_0px_0px_rgba(0,0,0,0.2)]' : 'bg-gray-100'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-lg md:text-2xl font-serif font-bold uppercase flex items-center gap-2">
                              <MessageSquare size={20} className="md:w-6 md:h-6" /> AUTO READ
                            </label>
                            <button 
                              onClick={() => updateToggle('autoRead', !config?.autoRead)}
                              className={`w-12 h-6 md:w-16 md:h-8 pixel-border relative transition-colors ${config?.autoRead ? 'bg-black' : 'bg-gray-400'}`}
                            >
                              <div className={`absolute top-0 bottom-0 w-1/2 bg-white pixel-border transition-all ${config?.autoRead ? 'right-0' : 'left-0'}`} />
                            </button>
                          </div>
                          <p className="text-xs md:text-base font-bold opacity-80 uppercase">Otomatis centang biru saat pesan masuk.</p>
                        </div>

                        <div className={`p-4 md:p-6 pixel-border transition-all ${config?.autoTyping ? 'bg-[#4ade80] shadow-[inset_4px_4px_0px_0px_rgba(0,0,0,0.2)]' : 'bg-gray-100'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-lg md:text-2xl font-serif font-bold uppercase flex items-center gap-2">
                              <Terminal size={20} className="md:w-6 md:h-6" /> AUTO TYPING
                            </label>
                            <button 
                              onClick={() => updateToggle('autoTyping', !config?.autoTyping)}
                              className={`w-12 h-6 md:w-16 md:h-8 pixel-border relative transition-colors ${config?.autoTyping ? 'bg-black' : 'bg-gray-400'}`}
                            >
                              <div className={`absolute top-0 bottom-0 w-1/2 bg-white pixel-border transition-all ${config?.autoTyping ? 'right-0' : 'left-0'}`} />
                            </button>
                          </div>
                          <p className="text-xs md:text-base font-bold opacity-80 uppercase">Tampilkan status sedang mengetik secara otomatis.</p>
                        </div>
                      </div>
                      
                      <div className="space-y-3 md:space-y-4 bg-gray-100 p-4 md:p-6 pixel-border w-full text-black">
                        <label className="text-base sm:text-lg md:text-2xl font-serif font-bold text-black flex gap-2 items-center uppercase break-words w-full">
                          <User size={20} className="text-blue-600 shrink-0 md:w-6 md:h-6"/> <span>NOMOR DEWA (OWNER)</span>
                        </label>
                        <p className="text-sm md:text-xl font-bold text-black bg-yellow-200 border-l-4 md:border-l-8 border-black p-2 md:p-3 leading-snug">
                          Hanya nomor ini yang diakui sebagai Root Admin bot The Matrix.
                        </p>
                        <input
                          type="text"
                          value={config?.ownerNumber || ''}
                          onChange={(e) => setConfig({ ...config, ownerNumber: e.target.value })}
                          className="w-full bg-white text-black placeholder:text-gray-500 border-2 md:border-4 border-black p-3 md:p-4 text-base sm:text-lg md:text-2xl font-bold outline-none focus:bg-blue-100 shadow-inner block max-w-full"
                          placeholder="CTH. 62812345678"
                        />
                      </div>

                    </div>
                    <div className="bg-[#4ade80] p-4 md:p-6 border-t-2 md:border-t-4 border-black flex justify-end w-full">
                      <button
                        onClick={saveConfig}
                        disabled={configLoading}
                        className="pixel-button bg-white text-black py-2 px-4 md:py-3 md:px-8 text-sm md:text-xl flex items-center justify-center gap-2 md:gap-3 w-full md:w-auto"
                      >
                        {configLoading ? <Loader2 size={18} className="animate-spin md:w-5 md:h-5" /> : <Save size={18} className="md:w-5 md:h-5"/>} <span className="truncate">SIMPAN PENGATURAN</span>
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
