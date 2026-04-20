import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import makeWASocket, { 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion, 
  DisconnectReason,
  proto,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import { Boom } from '@hapi/boom';
import config from './config.ts';
import moment from 'moment-timezone';
import { getDatabase } from './src/lib/database.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isBotMessage(m: any) {
    const messageId = m.key?.id || '';
    const isBaileys = messageId.startsWith('BAE5') && messageId.length === 16;
    const isBaileys2 = messageId.startsWith('3EB0');
    const isBaileys3 = /^3A[A-F0-9]{14,}/i.test(messageId);
    
    if (isBaileys || isBaileys2 || isBaileys3) return { isBot: true, reason: 'baileys' };
    
    const msg = m.message || {};
    if (msg.deviceSentMessage) return { isBot: true, reason: 'deviceSentMessage' };
    if (msg.buttonsMessage || msg.templateMessage || msg.listMessage || msg.buttonsResponseMessage || msg.listResponseMessage) {
        return { isBot: true, reason: 'interactive' };
    }

    return { isBot: false, reason: null };
}

const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// Global active socket and status
let activeSocket: any = null;
let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
const globalAbsensi: { [key: string]: any } = {};
const afkStorage = new Map<string, { reason: string, time: number }>();
const messageCache = new Map<string, any>();

const DEFAULT_TOXIC_WORDS = [
    'anjing', 'bangsat', 'kontol', 'memek', 'ngentot', 'babi', 'tolol',
    'goblok', 'idiot', 'bodoh', 'kampret', 'asu', 'jancok', 'bajingan',
    'keparat', 'setan', 'iblis', 'tai', 'brengsek', 'sialan'
];

function isToxic(text: string, toxicList: string[]) {
    if (!text || typeof text !== 'string') return { toxic: false, word: null };
    const lowerText = text.toLowerCase().trim();
    if (!lowerText) return { toxic: false, word: null };

    const words = (toxicList && toxicList.length > 0) ? toxicList : DEFAULT_TOXIC_WORDS;

    for (const word of words) {
        if (!word) continue;
        const lowerWord = word.toLowerCase().trim();
        if (!lowerWord) continue;

        const escapedWord = lowerWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(^|\\s|[^a-zA-Z0-9])${escapedWord}($|\\s|[^a-zA-Z0-9])`, 'i');

        if (regex.test(lowerText)) {
            return { toxic: true, word };
        }
    }
    return { toxic: false, word: null };
}

// Telemetry & Stats
let messagesProcessed = 0;
let activeGroupsCount = 0;
const systemLogs: { time: string, message: string, type: 'info' | 'warn' | 'error' | 'success' }[] = [];

function addSystemLog(message: string, type: 'info' | 'warn' | 'error' | 'success' = 'info') {
    const timestamp = new Date().toLocaleTimeString('id-ID', { hour12: false });
    systemLogs.unshift({ time: timestamp, message, type });
    if (systemLogs.length > 50) systemLogs.pop();
}

function formatDuration(ms: number) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
        return `${hours} jam ${minutes % 60} menit`;
    } else if (minutes > 0) {
        return `${minutes} menit ${seconds % 60} detik`;
    } else {
        return `${seconds} detik`;
    }
}

// Keep-alive/Stay-awake Ping
function startKeepAlive(url: string) {
    setInterval(async () => {
        try {
            await fetch(url);
            console.log(`[KEEP-ALIVE] Pinged ${url} to stay awake.`);
        } catch (e) {
            // Ignore fetch errors during keep-alive
        }
    }, 10 * 60 * 1000); // Pulse every 10 minutes
}

// Global Exception Handlers to prevent 24/7 downtime
process.on('uncaughtException', (err) => {
    console.error('FATAL: Uncaught Exception:', err);
    addSystemLog(`CRITICAL: System error - ${err.message}`, 'error');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('FATAL: Unhandled Rejection at:', promise, 'reason:', reason);
    addSystemLog(`CRITICAL: Unhandled promise rejection`, 'error');
});

const SESSION_ID = 'main_session';

async function connectToWhatsApp(sessionId: string, phoneNumber?: string, res?: any) {
    // Prevent multiple concurrent connection attempts
    if (activeSocket && connectionStatus === 'connecting' && !phoneNumber) {
        console.log('Already attempting to connect...');
        return activeSocket;
    }

    // Cleanup existing socket safely
    if (activeSocket) {
        try {
            activeSocket.ev.removeAllListeners('connection.update');
            activeSocket.ev.removeAllListeners('creds.update');
            activeSocket.ev.removeAllListeners('messages.upsert');
            activeSocket.end(undefined);
        } catch (e) {
            console.error('Error during socket cleanup:', e);
        }
    }

    const sessionPath = path.join(sessionsDir, sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    connectionStatus = 'connecting';

    const sock = makeWASocket({
        version,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false, // Prevents downloading huge chat history on startup
        generateHighQualityLinkPreview: false, // Saves rendering time
        markOnlineOnConnect: true,
        getMessage: async (key) => {
            return {
                conversation: 'Pesan ini sedang diproses...'
            };
        }
    });

    activeSocket = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'connecting') {
            connectionStatus = 'connecting';
        } else if (connection === 'close') {
            connectionStatus = 'disconnected';
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            const shouldReconnect = !isLoggedOut;
            
            console.log(`Connection closed. Status: ${statusCode}, Should Reconnect: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                // Exponential backoff or simple delay for stability
                const delay = statusCode === DisconnectReason.restartRequired ? 1000 : 5000;
                setTimeout(() => {
                    console.log('Attempting auto-reconnect...');
                    connectToWhatsApp(sessionId);
                }, delay);
            } else {
                console.log('Logout detected from device. Purging session data...');
                const sessionPath = path.join(sessionsDir, sessionId);
                if (fs.existsSync(sessionPath)) {
                    try {
                        fs.rmSync(sessionPath, { recursive: true, force: true });
                    } catch (e) {
                        console.error('Failed to purge session directory:', e);
                    }
                }
                activeSocket = null;
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            console.log('WhatsApp connection opened');
            addSystemLog('WhatsApp connection established.', 'success');
            
            // Retrieve active groups asynchronously without blocking startup
            setTimeout(async () => {
                try {
                    const groups = await sock.groupFetchAllParticipating();
                    activeGroupsCount = Object.keys(groups).length;
                    addSystemLog(`Bot is actively monitoring ${activeGroupsCount} groups.`, 'info');
                } catch (e) {
                    console.error('Failed to fetch groups:', e);
                }
            }, 5000);
        }

        if (update.qr) {
            console.log('New QR generated (not displayed)');
        }
    });

    // Handle Messages (Command Handler)
    sock.ev.on('messages.upsert', async (chat) => {
        if (chat.type !== 'notify') return; // FAST RESPONSE: Only process real-time messages, ignore history sync spam
        
        const m = chat.messages[0];
        if (!m.message) return;

        // Cache message for Anti-Remove
        if (m.key.id) {
            messageCache.set(m.key.id, m);
            // Cleanup cache after 5 minutes to save memory
            setTimeout(() => messageCache.delete(m.key.id!), 300000);
        }

        messagesProcessed++;
        
        const chatId = m.key.remoteJid || '';
        
        // Extract body from various potential message types
        let body = (
            m.message.conversation || 
            m.message.extendedTextMessage?.text || 
            m.message.imageMessage?.caption || 
            m.message.videoMessage?.caption || 
            m.message.documentWithCaptionMessage?.message?.documentMessage?.caption ||
            m.message.buttonsResponseMessage?.selectedButtonId ||
            m.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
            m.message.templateButtonReplyMessage?.selectedId ||
            ''
        ).trim();

        const db = getDatabase();
        const isGroup = chatId.endsWith('@g.us');
        const sender = m.key.participant || m.key.remoteJid || '';
        const prefix = '.';
        const isFromMe = m.key.fromMe || false;

        // Auto-Read and Auto-Typing Settings
        const settings = db.getSettings();
        if (settings.autoRead && !isFromMe) {
            await sock.readMessages([m.key]);
            console.log(`[AUTO-READ] Marked message from ${sender} as read`);
        }
        if (settings.autoTyping && !isFromMe) {
            await sock.sendPresenceUpdate('composing', chatId);
            console.log(`[AUTO-TYPING] Sending presence for ${chatId}`);
        }

        const reply = (text: string, options: any = {}) => sock.sendMessage(chatId, { text, ...options }, { quoted: m });

        // Auto-Forward Logic
        if (!isFromMe) {
            const allGroups = db.data.groups || {};
            for (const targetJid in allGroups) {
                if (allGroups[targetJid].autoforward && targetJid !== chatId) {
                    try {
                        await sock.sendMessage(targetJid, { forward: m });
                    } catch (e) {
                        console.error(`Failed to auto-forward to ${targetJid}:`, e);
                    }
                }
            }
        }

        // AFK Check logic
        // 1. Returning from AFK (Allow owner to return too)
        if (afkStorage.has(sender)) {
            // Don't remove AFK if they are just setting it again
            const args = body.slice(prefix.length).trim().split(/ +/);
            const command = args.shift()?.toLowerCase();
            const isSetAfk = body.startsWith(prefix) && ['afk', 'away', 'brb'].includes(command || '');

            if (!isSetAfk) {
                const afkData = afkStorage.get(sender)!;
                afkStorage.delete(sender);
                const duration = formatDuration(Date.now() - afkData.time);
                await reply(`👋 *ᴀꜰᴋ ʙᴇʀᴀᴋʜɪʀ*\n\n` +
                    `\`\`\`@${sender.split('@')[0]} sudah kembali!\`\`\`\n` +
                    `🍀 \`Durasi AFK:\` *${duration}*`, { mentions: [sender] });
            }
        }

        // 2. Mentioning an AFK user
        const mentionedJid = (
            m.message?.extendedTextMessage?.contextInfo?.mentionedJid || 
            m.message?.imageMessage?.contextInfo?.mentionedJid ||
            m.message?.videoMessage?.contextInfo?.mentionedJid ||
            []
        );
        if (isGroup && mentionedJid.length > 0) {
            for (const jid of mentionedJid) {
                if (afkStorage.has(jid)) {
                    const data = afkStorage.get(jid)!;
                    const duration = formatDuration(Date.now() - data.time);
                    await reply(`💤 *ᴜsᴇʀ ᴀꜰᴋ*\n\n` +
                        `\`\`\`Hustt, jangan di ganggu!\`\`\` \`@${jid.split('@')[0]}\` lagi AFK\n` +
                        `🍀 \`Alasan:\` *${data.reason}*\n` +
                        `🍀 \`Sejak:\` *${duration} yang lalu*`, { mentions: [jid] });
                }
            }
        }

        // Sticker to Command Detection
        const stickerMsg = m.message.stickerMessage;
        if (stickerMsg?.fileSha256) {
            const hash = Buffer.from(stickerMsg.fileSha256).toString('hex');
            const stickerCmd = db.data.stickerCommands?.[hash];
            if (stickerCmd) {
                console.log(`[STICKER-CMD] Hash: ${hash} -> Command: ${stickerCmd}`);
                body = prefix + stickerCmd;
            }
        }

        // Anti-link enforcement
        if (isGroup && body) {
            const groupData = db.getGroup(chatId);
            const antilinkList = groupData.antilinkList || [];
            const antilinkActive = groupData.antilinkActive ?? false;

            if (antilinkActive) {
                const linkKeywords = ['http://', 'https://', 'www.', 'chat.whatsapp.com', 'wa.me', 't.me'];
                const containsLink = linkKeywords.some(kw => body.toLowerCase().includes(kw)) || antilinkList.some(pattern => body.toLowerCase().includes(pattern.toLowerCase()));
                
                if (containsLink) {
                    // Check if sender is admin
                    const groupMetadata = await sock.groupMetadata(chatId);
                    const participant = groupMetadata.participants.find(p => p.id === sender);
                    const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');

                    if (!isSenderAdmin) {
                        try {
                            console.log(`[ANTILINK] Deleting message from ${sender} in ${chatId}`);
                            await sock.sendMessage(chatId, { delete: m.key });
                            return; // Stop processing this message
                        } catch (e) {
                            console.error('Failed to delete link message:', e);
                        }
                    }
                }
            }
        }

        // Anti-linkall enforcement
        if (isGroup && body) {
            const groupData = db.getGroup(chatId);
            const antilinkall = groupData.antilinkall || 'off';
            const mode = groupData.antilinkallMode || 'remove';

            if (antilinkall === 'on') {
                const linkKeywords = ['http://', 'https://', 'www.'];
                const containsLink = linkKeywords.some(kw => body.toLowerCase().includes(kw));

                if (containsLink) {
                    // Check if sender is admin
                    const groupMetadata = await sock.groupMetadata(chatId);
                    const participant = groupMetadata.participants.find(p => p.id === sender);
                    const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');

                    if (!isSenderAdmin) {
                        try {
                            console.log(`[ANTILINKALL] Detected link from ${sender} in ${chatId} | Mode: ${mode}`);
                            await sock.sendMessage(chatId, { delete: m.key });
                            
                            if (mode === 'kick') {
                                // Check if bot is admin
                                const myJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
                                const me = groupMetadata.participants.find(p => p.id === myJid);
                                const isBotAdmin = me && (me.admin === 'admin' || me.admin === 'superadmin');

                                if (isBotAdmin) {
                                    await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
                                    await sock.sendMessage(chatId, { 
                                        text: `🚫 *ᴀɴᴛɪʟɪɴᴋ ᴀʟʟ* — @${sender.split('@')[0]} telah di-kick karena mengirim link.`,
                                        mentions: [sender]
                                    });
                                } else {
                                    await reply(`⚠️ *ᴀɴᴛɪʟɪɴᴋ ᴀʟʟ* — Pesan dihapus. Jadikan bot admin untuk fitur KICK.`);
                                }
                            } else {
                                await reply(`⚠️ *ᴀɴᴛɪʟɪɴᴋ ᴀʟʟ* — Link dilarang di grup ini! @${sender.split('@')[0]} pesan kamu dihapus.`, { mentions: [sender] });
                            }
                            return; // Stop processing
                        } catch (e) {
                            console.error('Failed to process antilinkall:', e);
                        }
                    }
                }
            }
        }

        // Anti-linkgc enforcement
        if (isGroup && body) {
            const groupData = db.getGroup(chatId);
            const antilinkgc = groupData.antilinkgc || 'off';
            const mode = groupData.antilinkgcMode || 'remove';

            if (antilinkgc === 'on') {
                const linkKeywords = ['chat.whatsapp.com', 'wa.me', 'whatsapp.com/channel'];
                const containsLink = linkKeywords.some(kw => body.toLowerCase().includes(kw));

                if (containsLink) {
                    // Check if sender is admin
                    const groupMetadata = await sock.groupMetadata(chatId);
                    const participant = groupMetadata.participants.find(p => p.id === sender);
                    const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');

                    if (!isSenderAdmin) {
                        try {
                            console.log(`[ANTILINKGC] Detected WA link from ${sender} in ${chatId} | Mode: ${mode}`);
                            await sock.sendMessage(chatId, { delete: m.key });
                            
                            if (mode === 'kick') {
                                // Check if bot is admin
                                const myJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
                                const me = groupMetadata.participants.find(p => p.id === myJid);
                                const isBotAdmin = me && (me.admin === 'admin' || me.admin === 'superadmin');

                                if (isBotAdmin) {
                                    await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
                                    await sock.sendMessage(chatId, { 
                                        text: `🚫 *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* — @${sender.split('@')[0]} telah di-kick karena mengirim link WhatsApp.`,
                                        mentions: [sender]
                                    });
                                } else {
                                    await reply(`⚠️ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* — Pesan dihapus. Jadikan bot admin untuk fitur KICK.`);
                                }
                            } else {
                                await reply(`⚠️ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* — Link WhatsApp dilarang! @${sender.split('@')[0]} pesan kamu dihapus.`, { mentions: [sender] });
                            }
                            return; // Stop processing
                        } catch (e) {
                            console.error('Failed to process antilinkgc:', e);
                        }
                    }
                }
            }
        }

        // Anti-Sticker enforcement
        if (isGroup && stickerMsg) {
            const groupData = db.getGroup(chatId);
            if (groupData.antisticker) {
                // Check if sender is admin
                const groupMetadata = await sock.groupMetadata(chatId);
                const participant = groupMetadata.participants.find(p => p.id === sender);
                const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
                const isOwner = config.isOwner(sender);

                if (!isSenderAdmin && !isOwner) {
                    try {
                        console.log(`[ANTISTICKER] Deleting sticker from ${sender} in ${chatId}`);
                        await sock.sendMessage(chatId, { delete: m.key });
                        await sock.sendMessage(chatId, {
                            text: `⚠ *AntiSticker* — Sticker dari @${sender.split('@')[0]} dihapus.`,
                            mentions: [sender]
                        });
                        return; // Stop processing
                    } catch (e) {
                        console.error('Failed to delete sticker:', e);
                    }
                }
            }
        }

        // Anti-Tag SW enforcement
        const isTagSW = m.message?.groupStatusMentionMessage;
        if (isGroup && isTagSW) {
            const groupData = db.getGroup(chatId);
            if (groupData.antitagsw === 'on') {
                // Check if sender is admin
                const groupMetadata = await sock.groupMetadata(chatId);
                const participant = groupMetadata.participants.find(p => p.id === sender);
                const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
                const isOwner = config.isOwner(sender);

                if (!isSenderAdmin && !isOwner) {
                    try {
                        console.log(`[ANTITAGSW] Deleting status tag message from ${sender} in ${chatId}`);
                        await sock.sendMessage(chatId, { delete: m.key });
                        return; // Stop processing
                    } catch (e) {
                        console.error('Failed to delete status tag message:', e);
                    }
                }
            }
        }

        // Anti-toxic enforcement
        if (isGroup && body) {
            const groupData = db.getGroup(chatId);
            if (groupData.antitoxic) {
                const toxicCheck = isToxic(body, groupData.toxicWords || []);
                if (toxicCheck.toxic) {
                    // Check if sender is admin
                    const groupMetadata = await sock.groupMetadata(chatId);
                    const participant = groupMetadata.participants.find(p => p.id === sender);
                    const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
                    const isOwner = config.isOwner(sender);

                    if (!isSenderAdmin && !isOwner) {
                        try {
                            const maxWarn = groupData.toxicMaxWarn || 3;
                            const method = groupData.toxicMethod || 'kick';
                            const warnCount = (groupData.toxicWarns?.[sender] || 0) + 1;

                            if (!groupData.toxicWarns) groupData.toxicWarns = {};
                            groupData.toxicWarns[sender] = warnCount;
                            db.setGroup(chatId, groupData);

                            await sock.sendMessage(chatId, { delete: m.key });

                            const senderTag = sender.split('@')[0];

                            if (warnCount >= maxWarn) {
                                if (method === 'kick') {
                                    // Check if bot is admin
                                    const myJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
                                    const me = groupMetadata.participants.find(p => p.id === myJid);
                                    if (me && (me.admin === 'admin' || me.admin === 'superadmin')) {
                                        await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
                                    }
                                }

                                groupData.toxicWarns[sender] = 0;
                                db.setGroup(chatId, groupData);

                                await sock.sendMessage(chatId, {
                                    text: `🚫 @${senderTag} di-${method} karena toxic. (${warnCount}/${maxWarn})`,
                                    mentions: [sender],
                                });
                            } else {
                                await sock.sendMessage(chatId, {
                                    text: `⚠ @${senderTag} berkata kasar.\nPeringatan ke ${warnCount} dari ${maxWarn}, pelanggaran berikutnya bisa di-${method}.`,
                                    mentions: [sender],
                                });
                            }
                            return; // Stop processing
                        } catch (e) {
                            console.error('Failed to handle toxic message:', e);
                        }
                    }
                }
            }
        }

        // Anti-bot enforcement
        if (isGroup) {
            const groupData = db.getGroup(chatId);
            if (groupData?.antibot) {
                const botCheck = isBotMessage(m);
                if (botCheck.isBot) {
                    const groupMetadata = await sock.groupMetadata(chatId);
                    
                    // Check if sender is admin
                    const participant = groupMetadata.participants.find(p => p.id === sender);
                    const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
                    
                    // Check if bot is admin
                    const myJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
                    const me = groupMetadata.participants.find(p => p.id === myJid);
                    const isBotAdmin = me && (me.admin === 'admin' || me.admin === 'superadmin');

                    if (!isSenderAdmin && isBotAdmin) {
                        try {
                            console.log(`[ANTIBOT] Deteksi bot dari ${sender} di ${chatId} (${botCheck.reason})`);
                            await sock.sendMessage(chatId, { delete: m.key });
                            await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
                            await sock.sendMessage(chatId, { 
                                text: `🤖 *AntiBot* — @${sender.split('@')[0]} terdeteksi sebagai bot dan telah di-kick.`,
                                mentions: [sender]
                            });
                            return; // Stop processing
                        } catch (e) {
                            console.error('Failed to kick bot:', e);
                        }
                    }
                }
            }
        }

        // Auto-Download detection
        if (isGroup && body) {
            const groupData = db.getGroup(chatId);
            if (groupData?.autodl) {
                const socialLinks = [
                    /tiktok\.com/i, /vt\.tiktok\.com/i, 
                    /instagram\.com/i, /fb\.watch/i, /facebook\.com/i, 
                    /youtube\.com/i, /youtu\.be/i, 
                    /twitter\.com/i, /x\.com/i,
                    /t\.me\//i, /discord\.gg/i
                ];
                const hasSocialLink = socialLinks.some(regex => regex.test(body));
                
                if (hasSocialLink) {
                    console.log(`[AUTODL] Social link detected from ${sender} in ${chatId}`);
                    // Detection works, actual downloader requires specific logic/API
                }
            }
        }

        // Anti-document enforcement
        if (isGroup) {
            const groupData = db.getGroup(chatId);
            if (groupData?.antidocument) {
                const isDoc = !!(m.message?.documentMessage || m.message?.documentWithCaptionMessage);
                if (isDoc) {
                    const groupMetadata = await sock.groupMetadata(chatId);
                    const participant = groupMetadata.participants.find(p => p.id === sender);
                    const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
                    
                    if (!isSenderAdmin) {
                        try {
                            console.log(`[ANTIDOC] Deleting document from ${sender} in ${chatId}`);
                            await sock.sendMessage(chatId, { delete: m.key });
                            await reply(`📄 *AntiDocument* — Dokumen dari @${sender.split('@')[0]} telah dihapus.`, { mentions: [sender] });
                            return; // Stop processing
                        } catch (e) {
                            console.error('Failed to delete document message:', e);
                        }
                    }
                }
            }
        }

        // Anti-media enforcement
        if (isGroup) {
            const groupData = db.getGroup(chatId);
            if (groupData?.antimedia) {
                const isMedia = !!(m.message?.imageMessage || m.message?.videoMessage);
                if (isMedia) {
                    const groupMetadata = await sock.groupMetadata(chatId);
                    const participant = groupMetadata.participants.find(p => p.id === sender);
                    const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
                    
                    if (!isSenderAdmin) {
                        try {
                            console.log(`[ANTIMEDIA] Deleting media from ${sender} in ${chatId}`);
                            await sock.sendMessage(chatId, { delete: m.key });
                            await reply(`🖼️ *AntiMedia* — Media dari @${sender.split('@')[0]} telah dihapus.`, { mentions: [sender] });
                            return; // Stop processing
                        } catch (e) {
                            console.error('Failed to delete media message:', e);
                        }
                    }
                }
            }
        }

        // Automatic Media conversion (Sticker to Image)
        if (isGroup && !isFromMe) {
            const groupData = db.getGroup(chatId);
            if (groupData?.automedia) {
                const stickerMsg = m.message?.stickerMessage;
                // Only non-animated stickers
                if (stickerMsg && !stickerMsg.isAnimated) {
                    try {
                        const buffer = await downloadMediaMessage(m, 'buffer', {}, { 
                            logger: pino({ level: 'silent' }),
                            reuploadRequest: (sock as any).reuploadRequest
                        });
                        if (buffer) {
                             await sock.sendMessage(chatId, { image: buffer as Buffer, caption: `📩 *ᴀᴜᴛᴏ ᴍᴇᴅɪᴀ* — Konversi sticker otomatis.` }, { quoted: m });
                        }
                    } catch (e) {
                        console.error('Failed to auto-convert sticker:', e);
                    }
                }
            }
        }

        if (!body.startsWith(prefix)) return;
        
        // Anti-loop: If from me and reached here, it MUST be a command. 
        // If it was from me and NOT a command, we should have caught it above or here.
        if (isFromMe && !body.startsWith(prefix)) return;

        const args = body.slice(prefix.length).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();
        
        console.log(`[CMD] From: ${sender} | Command: ${command} | Args: ${args.join(' ')}`);

        // Simple Ping Command
        if (command === 'ping') {
            return reply('Pong! Bot is active and responding. ⚡');
        }

        // Command: .mulaiabsen
        if (command === 'mulaiabsen') {
            const isGroup = chatId.endsWith('@g.us');
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            const keterangan = args.join(' ') || 'Tidak ada keterangan';
            globalAbsensi[chatId] = {
                keterangan,
                peserta: []
            };

            return reply(`✅ *sᴇsɪ ᴀʙsᴇɴ ᴅɪᴍᴜʟᴀɪ*\n\n> *Keterangan:* ${keterangan}\n\nKetik *${prefix}absen* untuk hadir!`);
        }

        // Command: .absen
        if (['absen', 'hadir', 'present'].includes(command || '')) {
            if (!globalAbsensi[chatId]) {
                return reply(
                    `❌ *ᴛɪᴅᴀᴋ ᴀᴅᴀ ᴀʙsᴇɴ*\n\n` +
                    `> Belum ada sesi absen di grup ini!\n\n` +
                    `> Mulai dengan *.mulaiabsen [keterangan]*`
                );
            }

            const absen = globalAbsensi[chatId];
            if (absen.peserta.includes(sender)) {
                return reply(`❌ Kamu sudah absen!`);
            }

            absen.peserta.push(sender);
            const dateStr = moment().tz('Asia/Jakarta').format('D MMMM YYYY');
            const list = absen.peserta.map((jid: string, i: number) => `┃ ${i + 1}. @${jid.split('@')[0]}`).join('\n');

            return reply(
                `✅ *MANTAP, @${sender.split('@')[0]} HADIRR*\n` +
                `TUJUAN ABSEN: ${absen.keterangan}\n` +
                `╭┈┈⬡「 📋 INFO LAIN 」\n` +
                `┃ 📅 ${dateStr}\n` +
                `┃ 👥 Total: ${absen.peserta.length}\n` +
                `├┈┈⬡「 📝 *ᴅᴀғᴛᴀʀ ʜᴀᴅɪʀ* 」\n` +
                `${list}\n` +
                `╰┈┈┈┈┈┈┈┈⬡\n\n` +
                `> _Ketik *${prefix}absen* untuk hadir_\n` +
                `> _Ketik *${prefix}cekabsen* untuk melihat daftar_`,
                { mentions: absen.peserta }
            );
        }

        // Command: .cekabsen
        if (command === 'cekabsen') {
            if (!globalAbsensi[chatId]) return reply('❌ Tidak ada sesi absen aktif.');
            const absen = globalAbsensi[chatId];
            const dateStr = moment().tz('Asia/Jakarta').format('D MMMM YYYY');
            const list = absen.peserta.map((jid: string, i: number) => `┃ ${i + 1}. @${jid.split('@')[0]}`).join('\n');

            return reply(
                `📋 *ᴅᴀғᴛᴀʀ ʜᴀᴅɪʀ sᴀᴀᴛ ɪɴɪ*\n` +
                `TUJUAN: ${absen.keterangan}\n` +
                `╭┈┈⬡「 📋 INFO 」\n` +
                `┃ 📅 ${dateStr}\n` +
                `┃ 👥 Total: ${absen.peserta.length}\n` +
                `├┈┈⬡「 📝 *ʟɪsᴛ* 」\n` +
                `${list || '┃ (Belum ada)'}\n` +
                `╰┈┈┈┈┈┈┈┈⬡`,
                { mentions: absen.peserta }
            );
        }

        // Command: .hapusabsen
        if (command === 'hapusabsen') {
            if (!globalAbsensi[chatId]) return reply('❌ Tidak ada sesi absen yang bisa dihapus.');
            delete globalAbsensi[chatId];
            return reply('✅ Sesi absen telah dihapus.');
        }

        // Command: .acc (Join Request Manager)
        if (['acc', 'accall', 'joinrequest', 'reqjoin'].includes(command || '')) {
            const isGroup = chatId.endsWith('@g.us');
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check if user is admin (Basic check, in production you'd want a more robust check)
            // For now, let's assume if they can trigger other group commands they are allowed, 
            // but Baileys will throw an error if the bot itself isn't admin.
            
            const sub = args[0]?.toLowerCase();
            const option = args.slice(1).join(' ')?.trim();

            if (!sub || !['list', 'approve', 'reject'].includes(sub)) {
                return reply(
                    `📋 *ᴊᴏɪɴ ʀᴇQᴜᴇsᴛ ᴍᴀɴᴀɢᴇᴀʀ*\n\n` +
                    `╭┈┈⬡「 📌 *ᴄᴏᴍᴍᴀɴᴅ* 」\n` +
                    `┃ ${prefix}acc list\n` +
                    `┃ ${prefix}acc approve all\n` +
                    `┃ ${prefix}acc reject all\n` +
                    `┃ ${prefix}acc approve 1|2|3\n` +
                    `┃ ${prefix}acc reject 1|2|3\n` +
                    `╰┈┈┈┈┈┈┈┈⬡`
                );
            }

            try {
                // @ts-ignore
                const groupMetadata = await sock.groupMetadata(chatId);
                const botJid = sock.user?.id.split(':')[0] + '@s.whatsapp.net';
                const botParticipant = groupMetadata.participants.find(p => p.id === botJid);
                const isBotAdmin = botParticipant && (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin');

                if (!isBotAdmin) {
                    return reply('❌ Bot bukan admin! Jadikan bot sebagai admin grup terlebih dahulu untuk menggunakan fitur ini.');
                }

                if (typeof sock.groupRequestParticipantsList !== 'function') {
                    return reply('❌ Fitur ini tidak didukung oleh versi library saat ini atau bot sedang mengalami masalah fungsi internal.');
                }

                // @ts-ignore - groupRequestParticipantsList might not be in all Baileys versions type definitions but exists
                const pendingList = await sock.groupRequestParticipantsList(chatId);

                if (!pendingList?.length) {
                    return reply(`📭 Tidak ada permintaan masuk yang tertunda.`);
                }

                if (sub === 'list') {
                    let text = `📋 *ᴅᴀꜰᴛᴀʀ ᴘᴇʀᴍɪɴᴛᴀᴀɴ ᴍᴀsᴜᴋ*\n\n`;
                    text += `> Total: ${pendingList.length} permintaan\n\n`;

                    for (let i = 0; i < pendingList.length; i++) {
                        const req = pendingList[i];
                        const number = req.jid?.split('@')[0] || 'Unknown';
                        const time = req.request_time ? new Date(Number(req.request_time) * 1000).toLocaleString('id-ID') : '-';

                        text += `*${i + 1}.* @${number}\n`;
                        text += `   🕐 ${time}\n\n`;
                    }

                    text += `> Gunakan \`${prefix}acc approve all\` atau \`${prefix}acc reject all\``;
                    return reply(text, { mentions: pendingList.map((r: any) => r.jid) });
                }

                const action = sub as 'approve' | 'reject';

                if (option === 'all') {
                    const jids = pendingList.map((r: any) => r.jid);
                    // @ts-ignore
                    const results = await sock.groupRequestParticipantsUpdate(chatId, jids, action);
                    const success = results.filter((r: any) => r.status === '200' || !r.status || r.status === 200).length;
                    const failed = results.length - success;
                    const label = action === 'approve' ? 'Diterima' : 'Ditolak';

                    return reply(
                        `✅ *${label.toUpperCase()} SEMUA*\n\n` +
                        `> ✅ Berhasil: ${success}\n` +
                        `> ❌ Gagal: ${failed}\n` +
                        `> 📊 Total: ${results.length}`
                    );
                }

                const indices = option.split('|').map(n => parseInt(n.trim()) - 1).filter(n => !isNaN(n) && n >= 0 && n < pendingList.length);

                if (!indices.length) {
                    return reply(
                        `❌ Nomor tidak valid.\n\n` +
                        `> Gunakan \`${prefix}acc list\` untuk melihat daftar.\n` +
                        `> Contoh: \`${prefix}acc ${action} 1|2|3\``
                    );
                }

                const targets = indices.map(i => pendingList[i]);
                let resultText = '';
                const label = action === 'approve' ? 'Diterima' : 'Ditolak';
                let successCount = 0;

                for (const target of targets) {
                    try {
                        // @ts-ignore
                        const result = await sock.groupRequestParticipantsUpdate(chatId, [target.jid], action);
                        const status = result[0]?.status;
                        const ok = status === '200' || !status;
                        const number = target.jid.split('@')[0];
                        resultText += `${ok ? '✅' : '❌'} ${number} — ${ok ? label : 'Gagal'}\n`;
                        if (ok) successCount++;
                    } catch {
                        const number = target.jid.split('@')[0];
                        resultText += `❌ ${number} — Error\n`;
                    }
                }

                return reply(
                    `📋 *ʜᴀsɪʟ ${label.toUpperCase()}*\n\n` +
                    resultText + `\n` +
                    `> ✅ ${successCount}/${targets.length} berhasil`
                );

            } catch (err: any) {
                console.error('Group Request Error:', err);
                const isForbidden = err.message?.toLowerCase().includes('forbidden');
                if (isForbidden) {
                    return reply('❌ Gagal mengelola permintaan. Pastikan:\n1. Bot adalah admin grup\n2. Fitur "Setujui Peserta Baru" aktif di grup ini.');
                }
                return reply('❌ Terjadi kesalahan saat mengelola permintaan grup. Pastikan bot adalah admin dan fitur permintaan masuk aktif.');
            }
        }

        // Command: .add (Add/Invite Member)
        if (['add', 'addmember', 'invite'].includes(command || '')) {
            if (args.length === 0) {
                return reply(
                    `👥 *ᴀᴅᴅ ᴍᴇᴍʙᴇʀ*\n\n` +
                    `> Cara pakai:\n` +
                    `> 1. Di grup: \`${prefix}add <nomor>\`\n` +
                    `> 2. Multiple: \`${prefix}add <nomor1> <nomor2> ...\`\n` +
                    `> 3. Di private: \`${prefix}add <nomor> <link_grup>\`\n\n` +
                    `> Contoh:\n` +
                    `> \`${prefix}add 6281234567890\`\n` +
                    `> \`${prefix}add 628123 628456 628789\`\n` +
                    `> \`${prefix}add 628123 https://chat.whatsapp.com/xxx\`\n\n` +
                    `> Syarat:\n` +
                    `> - Bot harus admin di grup target\n` +
                    `> - Yang jalankan command harus admin`
                );
            }

            let targetGroup = chatId.endsWith('@g.us') ? chatId : null;
            let targetNumbers: string[] = [];

            for (const arg of args) {
                const linkMatch = arg.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
                if (linkMatch) {
                    try {
                        const groupInfo = await sock.groupGetInviteInfo(linkMatch[1]);
                        targetGroup = groupInfo.id;
                    } catch (e) {
                        return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Link grup tidak valid atau sudah expired!`);
                    }
                } else if (arg.includes('@g.us')) {
                    targetGroup = arg;
                } else {
                    let num = arg.replace(/[^0-9]/g, '');
                    if (num.startsWith('0')) {
                        num = '62' + num.slice(1);
                    }
                    if (num.length >= 10) {
                        targetNumbers.push(num);
                    }
                }
            }

            if (targetNumbers.length === 0) {
                return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Masukkan nomor yang valid!`);
            }

            if (!targetGroup) {
                return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Jalankan di grup atau sertakan link grup!\n\n\`${prefix}add <nomor> <link_grup>\``);
            }

            try {
                // @ts-ignore
                const groupMeta = await sock.groupMetadata(targetGroup);
                const botJid = sock.user?.id.split(':')[0] + '@s.whatsapp.net';
                const botParticipant = groupMeta.participants.find(p => p.id === botJid);
                
                if (!botParticipant || !['admin', 'superadmin'].includes(botParticipant.admin || '')) {
                    return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Bot bukan admin di grup *${groupMeta.subject}*!`);
                }

                // Check if sender is admin in target group
                const senderParticipant = groupMeta.participants.find(p => p.id === sender);
                if (!senderParticipant || !['admin', 'superadmin'].includes(senderParticipant.admin || '')) {
                    return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Kamu bukan admin di grup *${groupMeta.subject}*!`);
                }

                const validNumbers: string[] = [];
                const alreadyInGroup: string[] = [];

                for (const num of targetNumbers) {
                    const jid = num + '@s.whatsapp.net';
                    const isMember = groupMeta.participants.some(p => p.id === jid);
                    if (isMember) {
                        alreadyInGroup.push(num);
                    } else {
                        validNumbers.push(jid);
                    }
                }

                if (validNumbers.length === 0) {
                    return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Semua nomor sudah ada di grup!`);
                }

                await sock.sendMessage(chatId, { react: { text: '🕕', key: m.key } });

                const results = await sock.groupParticipantsUpdate(targetGroup, validNumbers, 'add');
                
                let successList: string[] = [];
                let invitedList: string[] = [];
                let failedList: { num: string, status: string }[] = [];

                for (const res of results) {
                    const num = res.jid?.split('@')[0] || res.content?.attrs?.phone_number?.replace('@s.whatsapp.net', '') || 'Unknown';
                    const status = res.status;
                    
                    if (status === '200') {
                        successList.push(num);
                    } else if (status === '408') {
                        invitedList.push(num);
                    } else {
                        failedList.push({ num, status });
                    }
                }

                let resultText = `🥗 @${sender.split('@')[0]} telah menambahkan member ke grup\n\n`;
                
                if (successList.length > 0) {
                    resultText += `Ada *${successList.length}* member yang berhasil ditambahkan:\n`;
                    successList.forEach(n => resultText += `• @${n}\n`);
                    resultText += `\n`;
                }
                
                if (invitedList.length > 0) {
                    resultText += `📨 *Dan ada juga *${invitedList.length}* member yang diundang:*\n`;
                    invitedList.forEach(n => resultText += `• @${n}\n`);
                    resultText += `\n`;
                }
                
                if (failedList.length > 0) {
                    resultText += `❌ *ɢᴀɢᴀʟ (${failedList.length}):*\n`;
                    failedList.forEach(f => resultText += `• @${f.num} (${f.status})\n`);
                    resultText += `\n`;
                }
                
                if (alreadyInGroup.length > 0) {
                    resultText += `⏭️ *sᴜᴅᴀʜ ᴅɪ ɢʀᴜᴘ (${alreadyInGroup.length}):*\n`;
                    alreadyInGroup.forEach(n => resultText += `• @${n}\n`);
                }

                const allMentioned = [
                    ...successList.map(n => n + '@s.whatsapp.net'),
                    ...invitedList.map(n => n + '@s.whatsapp.net'),
                    ...failedList.map(f => f.num + '@s.whatsapp.net'),
                    ...alreadyInGroup.map(n => n + '@s.whatsapp.net'),
                    sender
                ];

                await sock.sendMessage(chatId, { react: { text: (successList.length > 0 || invitedList.length > 0) ? '✅' : '❌', key: m.key } });
                return reply(resultText, { mentions: allMentioned });

            } catch (error: any) {
                await sock.sendMessage(chatId, { react: { text: '❌', key: m.key } });
                console.error('Add Member Error:', error);
                if (error.message?.includes('not-authorized')) {
                    return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Bot tidak memiliki izin untuk menambah member!`);
                } else if (error.message?.includes('forbidden')) {
                    return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Bot tidak memiliki akses ke grup ini!`);
                } else {
                    return reply(`❌ Terjadi kesalahan saat menambah member.`);
                }
            }
        }

        // Command: .addcmdsticker (Add sticker command)
        if (['addcmdsticker', 'setsticker', 'stickeradd', 'stickercmd'].includes(command || '')) {
            const commandName = args[0];
            
            if (!commandName) {
                const stickerCmds = db.data.stickerCommands || {};
                const hashes = Object.keys(stickerCmds);
                
                let txt = `🖼️ *sᴛɪᴄᴋᴇʀ ᴛᴏ ᴄᴏᴍᴍᴀɴᴅ*\n\n`
                txt += `> Reply sticker + ketik command yang ingin dijadikan shortcut.\n\n`
                txt += `*Contoh:*\n`
                txt += `> Reply sticker, lalu ketik:\n`
                txt += `> \`${prefix}addcmdsticker menu\`\n\n`
                
                if (hashes.length > 0) {
                    txt += `╭┈┈⬡「 📋 *ᴀᴋᴛɪꜰ* 」\n`
                    for (const hash of hashes.slice(0, 10)) {
                        txt += `┃ 🖼️ → \`${stickerCmds[hash]}\`\n`
                    }
                    if (hashes.length > 10) {
                        txt += `┃ ... dan ${hashes.length - 10} lainnya\n`
                    }
                    txt += `╰┈┈┈┈┈┈┈┈⬡`
                }
                
                return reply(txt);
            }

            const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const sticker = quotedMsg?.stickerMessage;
            
            if (!sticker?.fileSha256) {
                return reply('⚠️ *Reply sticker* yang ingin dijadikan command!');
            }

            const hash = Buffer.from(sticker.fileSha256).toString('hex');
            const cleanCmd = commandName.toLowerCase().replace(/^\./, '');
            
            // Check if stickerCommands exists
            if (!db.data.stickerCommands) db.data.stickerCommands = {};
            
            db.data.stickerCommands[hash] = cleanCmd;
            // Native JSON.stringify call from save() handles persistence
            fs.writeFileSync(path.join(process.cwd(), 'database.json'), JSON.stringify(db.data, null, 2));

            await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
            return reply(
                `✅ *sᴛɪᴄᴋᴇʀ ᴄᴏᴍᴍᴀɴᴅ ᴅɪᴛᴀᴍʙᴀʜᴋᴀɴ*\n\n` +
                `> 🖼️ Sticker → \`.${cleanCmd}\`\n\n` +
                `_Kirim sticker tersebut untuk menjalankan command!_`
            );
        }

        // Command: .delcmdsticker
        if (command === 'delcmdsticker') {
            const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const sticker = quotedMsg?.stickerMessage;
            
            if (!sticker?.fileSha256) {
                return reply('⚠️ *Reply sticker* yang ingin dihapus command-nya!');
            }

            const hash = Buffer.from(sticker.fileSha256).toString('hex');
            if (db.data.stickerCommands?.[hash]) {
                const oldCmd = db.data.stickerCommands[hash];
                delete db.data.stickerCommands[hash];
                fs.writeFileSync(path.join(process.cwd(), 'database.json'), JSON.stringify(db.data, null, 2));
                return reply(`✅ Shortcut untuk \`.${oldCmd}\` telah dihapus.`);
            } else {
                return reply('❌ Sticker tersebut tidak terdaftar sebagai shortcut command.');
            }
        }

        // Command: .addantilink (Add link to blocklist)
        if (['addantilink', 'addalink', 'addblocklink'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            if (!isSenderAdmin) return reply('❌ Perintah ini hanya untuk admin grup!');

            const link = args.join(' ').toLowerCase();
            if (!link) {
                return reply(
                    `🔗 *ᴀᴅᴅ ᴀɴᴛɪʟɪɴᴋ*\n\n` +
                    `> Masukkan domain/pattern link yang ingin diblokir\n\n` +
                    `\`Contoh:\`\n` +
                    `\`${prefix}addantilink tiktok.com\`\n` +
                    `\`${prefix}addantilink chat.whatsapp.com\`\n` +
                    `\`${prefix}addantilink instagram.com\``
                );
            }

            const groupData = db.getGroup(chatId);
            const antilinkList = groupData.antilinkList || [];

            if (antilinkList.includes(link)) {
                return reply(`⚠️ Link \`${link}\` sudah ada di daftar antilink!`);
            }

            antilinkList.push(link);
            db.setGroup(chatId, { antilinkList, antilinkActive: true });

            return reply(
                `✅ *ᴀɴᴛɪʟɪɴᴋ ᴅɪᴛᴀᴍʙᴀʜ*\n\n` +
                `> Link: \`${link}\`\n` +
                `> Total: *${antilinkList.length}* link\n` +
                `> Status Antilink: *AKTIF*\n\n` +
                `> Gunakan \`${prefix}listantilink\` untuk melihat daftar`
            );
        }

        // Command: .listantilink
        if (command === 'listantilink') {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            const groupData = db.getGroup(chatId);
            const list = groupData.antilinkList || [];
            const active = groupData.antilinkActive ?? false;

            let text = `📋 *ᴅᴀꜰᴛᴀʀ ᴀɴᴛɪʟɪɴᴋ*\n\n`;
            text += `> Status: *${active ? 'AKTIF' : 'MATI'}*\n`;
            text += `> Total: ${list.length} pattern\n\n`;

            if (list.length === 0) {
                text += `_Daftar masih kosong._`;
            } else {
                list.forEach((l: string, i: number) => {
                    text += `${i + 1}. \`${l}\`\n`;
                });
            }

            text += `\n> Gunakan \`${prefix}setantilink on/off\` untuk mengaktifkan/matikan.\n`;
            text += `> Gunakan \`${prefix}delantilink <nomor>\` untuk menghapus.`;
            return reply(text);
        }

        // Command: .setantilink
        if (command === 'setantilink') {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            if (!isSenderAdmin) return reply('❌ Perintah ini hanya untuk admin grup!');

            const action = args[0]?.toLowerCase();
            if (!action || !['on', 'off'].includes(action)) {
                return reply(`❌ Gunakan \`${prefix}setantilink on\` atau \`${prefix}setantilink off\``);
            }

            const active = action === 'on';
            db.setGroup(chatId, { antilinkActive: active });
            return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ʙᴇʀʜᴀsɪʟ ᴅɪ${active ? 'ᴀᴋᴛɪғᴋᴀɴ' : 'ɴᴏɴ-ᴀᴋᴛɪғᴋᴀɴ'}*`);
        }

        // Command: .delantilink
        if (command === 'delantilink') {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            if (!isSenderAdmin) return reply('❌ Perintah ini hanya untuk admin grup!');

            const index = parseInt(args[0]) - 1;
            const groupData = db.getGroup(chatId);
            const list = groupData.antilinkList || [];

            if (isNaN(index) || index < 0 || index >= list.length) {
                return reply(`❌ Nomor tidak valid. Cek \`${prefix}listantilink\``);
            }

            const removed = list.splice(index, 1);
            db.setGroup(chatId, { antilinkList: list });
            return reply(`✅ Link \`${removed[0]}\` berhasil dihapus dari daftar.`);
        }

        // Command: .addtoxic
        if (['addtoxic', 'tambahtoxic', 'addkata'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            if (!isSenderAdmin) return reply('❌ Perintah ini hanya untuk admin grup!');

            const word = args.join(' ').trim().toLowerCase();
            if (!word) {
                return reply(
                    `📝 *ᴀᴅᴅ ᴛᴏxɪᴄ*\n\n` +
                    `> Gunakan: \`.addtoxic <kata>\`\n\n` +
                    `\`Contoh: ${prefix}addtoxic katakasar\``
                );
            }
            
            if (word.length < 2) return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Kata terlalu pendek (min 2 huruf)`);
            if (word.length > 30) return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Kata terlalu panjang (max 30 huruf)`);

            const groupData = db.getGroup(chatId);
            const toxicWords = groupData.toxicWords || [];

            if (toxicWords.includes(word)) {
                return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Kata \`${word}\` sudah ada di daftar`);
            }

            toxicWords.push(word);
            db.setGroup(chatId, { toxicWords, antitoxicActive: true });

            await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
            return reply(
                `✅ *ᴋᴀᴛᴀ ᴛᴏxɪᴄ ᴅɪᴛᴀᴍʙᴀʜ*\n\n` +
                `╭┈┈⬡「 📋 *ᴅᴇᴛᴀɪʟ* 」\n` +
                `┃ 📝 ᴋᴀᴛᴀ: \`${word}\`\n` +
                `┃ 📊 ᴛᴏᴛᴀʟ: \`${toxicWords.length}\` kata\n` +
                `┃ 🛡️ Status: *AKTIF*\n` +
                `╰┈┈⬡`
            );
        }

        // Command: .listtoxic
        if (command === 'listtoxic') {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            const groupData = db.getGroup(chatId);
            const list = groupData.toxicWords || [];
            const active = groupData.antitoxicActive ?? false;

            let text = `📋 *ᴅᴀꜰᴛᴀʀ ᴋᴀᴛᴀ ᴛᴏxɪᴄ*\n\n`;
            text += `> Status: *${active ? 'AKTIF' : 'MATI'}*\n`;
            text += `> Total: ${list.length} kata\n\n`;

            if (list.length === 0) {
                text += `_Daftar masih kosong._`;
            } else {
                list.forEach((w: string, i: number) => {
                    text += `${i + 1}. \`${w}\`\n`;
                });
            }

            text += `\n> Gunakan \`${prefix}setantitoxic on/off\` untuk mengaktifkan/matikan.\n`;
            text += `> Gunakan \`${prefix}deltoxic <nomor>\` untuk menghapus.`;
            return reply(text);
        }

        // Command: .setantitoxic
        if (command === 'setantitoxic') {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            if (!isSenderAdmin) return reply('❌ Perintah ini hanya untuk admin grup!');

            const action = args[0]?.toLowerCase();
            if (!action || !['on', 'off'].includes(action)) {
                return reply(`❌ Gunakan \`${prefix}setantitoxic on\` atau \`${prefix}setantitoxic off\``);
            }

            const active = action === 'on';
            db.setGroup(chatId, { antitoxicActive: active });
            return reply(`✅ *ᴀɴᴛɪᴛᴏxɪᴄ ʙᴇʀʜᴀsɪʟ ᴅɪ${active ? 'ᴀᴋᴛɪғᴋᴀɴ' : 'ɴᴏɴ-ᴀᴋᴛɪғᴋᴀɴ'}*`);
        }

        // Command: .deltoxic
        if (command === 'deltoxic') {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            if (!isSenderAdmin) return reply('❌ Perintah ini hanya untuk admin grup!');

            const index = parseInt(args[0]) - 1;
            const groupData = db.getGroup(chatId);
            const list = groupData.toxicWords || [];

            if (isNaN(index) || index < 0 || index >= list.length) {
                return reply(`❌ Nomor tidak valid. Cek \`${prefix}listtoxic\``);
            }

            const removed = list.splice(index, 1);
            db.setGroup(chatId, { toxicWords: list });
            return reply(`✅ Kata \`${removed[0]}\` berhasil dihapus dari daftar.`);
        }

        // Command: .afk (Set AFK)
        if (['afk', 'away', 'brb'].includes(command || '')) {
            const reason = args.join(' ') || 'Tidak ada alasan';
            afkStorage.set(sender, {
                reason: reason,
                time: Date.now()
            });
            
            await sock.sendMessage(chatId, { react: { text: '💤', key: m.key } });
            return reply(
                `💤 *ᴀꜰᴋ ᴀᴋᴛɪꜰ*\n\n` +
                `\`\`\`@${sender.split('@')[0]} sekarang AFK\`\`\`\n` +
                `🍀 \`Alasan:\` *${reason}*\n\n` +
                `_Ketik apapun untuk menonaktifkan AFK._`,
                { mentions: [sender] }
            );
        }

        // Command: .antibot
        if (command === 'antibot') {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            if (!isSenderAdmin) return reply('❌ Perintah ini hanya untuk admin grup!');

            const action = args[0]?.toLowerCase();
            if (!action || !['on', 'off'].includes(action)) {
                const groupData = db.getGroup(chatId);
                const current = groupData.antibot || false;
                return reply(
                    `🤖 *AntiBot*\n\n` +
                    `> Status: ${current ? '✅ Aktif' : '❌ Nonaktif'}\n\n` +
                    `> \`${prefix}antibot on/off\``
                );
            }

            const active = action === 'on';
            db.setGroup(chatId, { antibot: active });
            
            await sock.sendMessage(chatId, { react: { text: active ? '✅' : '❌', key: m.key } });
            return reply(`✅ *AntiBot berhasil di${active ? 'aktifkan' : 'matikan'}*`);
        }

        // Command: .antidocument
        if (['antidocument', 'antidoc', 'nodoc'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            if (!isSenderAdmin) return reply('❌ Perintah ini hanya untuk admin grup!');

            const action = args[0]?.toLowerCase();
            if (!action || !['on', 'off'].includes(action)) {
                const groupData = db.getGroup(chatId);
                const current = groupData.antidocument || false;
                return reply(
                    `📄 *AntiDocument*\n\n` +
                    `> Status: ${current ? '✅ ON' : '❌ OFF'}\n\n` +
                    `> \`${prefix}${command} on/off\``
                );
            }

            const active = action === 'on';
            db.setGroup(chatId, { antidocument: active });
            
            await sock.sendMessage(chatId, { react: { text: active ? '✅' : '❌', key: m.key } });
            return reply(`✅ *AntiDocument berhasil di${active ? 'aktifkan' : 'matikan'}*`);
        }

        // Command: .antilinkall
        if (['antilinkall', 'alall', 'antialllink'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            if (!isSenderAdmin) return reply('❌ Perintah ini hanya untuk admin grup!');

            const option = args[0]?.toLowerCase();
            if (!option) {
                const groupData = db.getGroup(chatId);
                const status = groupData.antilinkall || 'off';
                const mode = groupData.antilinkallMode || 'remove';
                
                return reply(
                    `🔗 *ᴀɴᴛɪʟɪɴᴋ ᴀʟʟ*\n\n` +
                    `╭┈┈⬡「 📋 *sᴛᴀᴛᴜs* 」\n` +
                    `┃ ◦ Status: *${status.toUpperCase()}*\n` +
                    `┃ ◦ Mode: *${mode.toUpperCase()}*\n` +
                    `╰┈┈⬡\n\n` +
                    `> Mendeteksi semua jenis link (http/https/www)\n\n` +
                    `*ᴄᴀʀᴀ ᴘᴀᴋᴀɪ:*\n` +
                    `> \`${prefix}antilinkall on\` - Aktifkan\n` +
                    `> \`${prefix}antilinkall off\` - Nonaktifkan\n` +
                    `> \`${prefix}antilinkall metode kick\` - Mode kick user\n` +
                    `> \`${prefix}antilinkall metode remove\` - Mode hapus pesan`
                );
            }
            
            if (option === 'on') {
                db.setGroup(chatId, { antilinkall: 'on' });
                return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴀʟʟ* diaktifkan!\n\n> Semua link akan dihapus otomatis.`);
            }
            
            if (option === 'off') {
                db.setGroup(chatId, { antilinkall: 'off' });
                return reply(`❌ *ᴀɴᴛɪʟɪɴᴋ ᴀʟʟ* dinonaktifkan!`);
            }
            
            if (option.startsWith('metode')) {
                const method = args[1]?.toLowerCase();
                if (method === 'kick') {
                    db.setGroup(chatId, { antilinkall: 'on', antilinkallMode: 'kick' });
                    return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴀʟʟ* mode KICK diaktifkan!\n\n> User yang kirim link akan di-kick.`);
                } else if (method === 'remove' || method === 'delete') {
                    db.setGroup(chatId, { antilinkall: 'on', antilinkallMode: 'remove' });
                    return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴀʟʟ* mode DELETE diaktifkan!\n\n> Pesan dengan link akan dihapus.`);
                } else {
                    return reply(`❌ Metode tidak valid! Gunakan: \`kick\` atau \`remove\`\n\n> Contoh: \`${prefix}antilinkall metode kick\``);
                }
            }
            
            if (option === 'kick') {
                db.setGroup(chatId, { antilinkall: 'on', antilinkallMode: 'kick' });
                return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴀʟʟ* mode KICK diaktifkan!\n\n> User yang kirim link akan di-kick.`);
            }
            
            if (option === 'remove' || option === 'delete') {
                db.setGroup(chatId, { antilinkall: 'on', antilinkallMode: 'remove' });
                return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴀʟʟ* mode DELETE diaktifkan!\n\n> Pesan dengan link akan dihapus.`);
            }
            
            return reply(`❌ Opsi tidak valid! Gunakan: \`on\`, \`off\`, \`metode kick\`, \`metode remove\``);
        }

        // Command: .antilinkgc
        if (['antilinkgc', 'algc', 'antilinkgrup'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            if (!isSenderAdmin) return reply('❌ Perintah ini hanya untuk admin grup!');

            const option = args[0]?.toLowerCase();
            if (!option) {
                const groupData = db.getGroup(chatId);
                const status = groupData.antilinkgc || 'off';
                const mode = groupData.antilinkgcMode || 'remove';
                
                return reply(
                    `🔗 *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ*\n\n` +
                    `╭┈┈⬡「 📋 *sᴛᴀᴛᴜs* 」\n` +
                    `┃ ◦ Status: *${status.toUpperCase()}*\n` +
                    `┃ ◦ Mode: *${mode.toUpperCase()}*\n` +
                    `╰┈┈⬡\n\n` +
                    `*ᴅᴇᴛᴇᴋsɪ:*\n` +
                    `> • chat.whatsapp.com (grup)\n` +
                    `> • wa.me (kontak)\n` +
                    `> • whatsapp.com/channel (saluran)\n\n` +
                    `*ᴄᴀʀᴀ ᴘᴀᴋᴀɪ:*\n` +
                    `> \`${prefix}antilinkgc on\` - Aktifkan\n` +
                    `> \`${prefix}antilinkgc off\` - Nonaktifkan\n` +
                    `> \`${prefix}antilinkgc metode kick\` - Mode kick user\n` +
                    `> \`${prefix}antilinkgc metode remove\` - Mode hapus pesan`
                );
            }
            
            if (option === 'on') {
                db.setGroup(chatId, { antilinkgc: 'on' });
                return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* diaktifkan!\n\n> Link WA akan dihapus otomatis.`);
            }
            
            if (option === 'off') {
                db.setGroup(chatId, { antilinkgc: 'off' });
                return reply(`❌ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* dinonaktifkan!`);
            }
            
            if (option.startsWith('metode')) {
                const method = args[1]?.toLowerCase();
                if (method === 'kick') {
                    db.setGroup(chatId, { antilinkgc: 'on', antilinkgcMode: 'kick' });
                    return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* mode KICK diaktifkan!\n\n> User yang kirim link WA akan di-kick.`);
                } else if (method === 'remove' || method === 'delete') {
                    db.setGroup(chatId, { antilinkgc: 'on', antilinkgcMode: 'remove' });
                    return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* mode DELETE diaktifkan!\n\n> Pesan dengan link WA akan dihapus.`);
                } else {
                    return reply(`❌ Metode tidak valid! Gunakan: \`kick\` atau \`remove\`\n\n> Contoh: \`${prefix}antilinkgc metode kick\``);
                }
            }
            
            if (option === 'kick') {
                db.setGroup(chatId, { antilinkgc: 'on', antilinkgcMode: 'kick' });
                return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* mode KICK diaktifkan!\n\n> User yang kirim link WA akan di-kick.`);
            }
            
            if (option === 'remove' || option === 'delete') {
                db.setGroup(chatId, { antilinkgc: 'on', antilinkgcMode: 'remove' });
                return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* mode DELETE diaktifkan!\n\n> Pesan dengan link WA akan dihapus.`);
            }
            
            return reply(`❌ Opsi tidak valid! Gunakan: \`on\`, \`off\`, \`metode kick\`, \`metode remove\``);
        }

        // Command: .antimedia
        if (['antimedia', 'am', 'nomedia'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            if (!isSenderAdmin) return reply('❌ Perintah ini hanya untuk admin grup!');

            const action = args[0]?.toLowerCase();
            if (!action || !['on', 'off'].includes(action)) {
                const groupData = db.getGroup(chatId);
                const current = groupData.antimedia || false;
                return reply(
                    `🖼️ *AntiMedia*\n\n` +
                    `> Status: ${current ? '✅ ON' : '❌ OFF'}\n\n` +
                    `> \`${prefix}${command} on/off\``
                );
            }

            const active = action === 'on';
            db.setGroup(chatId, { antimedia: active });
            
            await sock.sendMessage(chatId, { react: { text: active ? '✅' : '❌', key: m.key } });
            return reply(`✅ *AntiMedia berhasil di${active ? 'aktifkan' : 'matikan'}*`);
        }

        // Command: .antiremove
        if (['antiremove', 'antidelete', 'antihapus', 'ar'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            if (!isSenderAdmin) return reply('❌ Perintah ini hanya untuk admin grup!');

            const action = args[0]?.toLowerCase();
            const groupData = db.getGroup(chatId) || {};

            if (!action || !['on', 'off'].includes(action)) {
                const status = groupData.antiremove || 'off';
                return reply(
                    `🗑️ *AntiRemove*\n\n` +
                    `> Status: *${status === 'on' ? '✅ Aktif' : '❌ Nonaktif'}*\n\n` +
                    `> \`${prefix}${command} on/off\``
                );
            }

            if (action === 'on') {
                db.setGroup(chatId, { ...groupData, antiremove: 'on' });
                await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
                await reply(`✅ *AntiRemove diaktifkan*\n> Pesan yang dihapus akan di-forward ulang.`);
                return;
            }

            if (action === 'off') {
                db.setGroup(chatId, { ...groupData, antiremove: 'off' });
                await sock.sendMessage(chatId, { react: { text: '❌', key: m.key } });
                await reply(`❌ *AntiRemove dinonaktifkan*`);
                return;
            }
        }

        // Command: .antisticker
        if (['antisticker', 'as', 'nosticker'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            const isOwner = config.isOwner(sender);
            if (!isSenderAdmin && !isOwner) return reply('❌ Perintah ini hanya untuk admin grup!');

            const action = args[0]?.toLowerCase();
            const groupData = db.getGroup(chatId) || {};

            if (!action || !['on', 'off'].includes(action)) {
                const status = groupData.antisticker ? '✅ ON' : '❌ OFF';
                return reply(
                    `🎭 *AntiSticker*\n\n` +
                    `> Status: *${status}*\n\n` +
                    `> \`${prefix}${command} on/off\``
                );
            }

            if (action === 'on') {
                db.setGroup(chatId, { ...groupData, antisticker: true });
                await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
                await reply(`✅ *AntiSticker diaktifkan*`);
                return;
            }

            if (action === 'off') {
                db.setGroup(chatId, { ...groupData, antisticker: false });
                await sock.sendMessage(chatId, { react: { text: '❌', key: m.key } });
                await reply(`❌ *AntiSticker dinonaktifkan*`);
                return;
            }
        }

        // Command: .antitagsw
        if (['antitagsw', 'antitag', 'antistatustag'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            const isOwner = config.isOwner(sender);
            if (!isSenderAdmin && !isOwner) return reply('❌ Perintah ini hanya untuk admin grup!');

            const action = args[0]?.toLowerCase();
            const groupData = db.getGroup(chatId) || {};

            if (!action || !['on', 'off'].includes(action)) {
                const status = groupData.antitagsw || 'off';
                return reply(
                    `📢 *ᴀɴᴛɪᴛᴀɢsᴡ sᴇᴛᴛɪɴɢs*\n\n` +
                    `> Status: *${status === 'on' ? '✅ Aktif' : '❌ Nonaktif'}*\n\n` +
                    `> Fitur ini menghapus pesan tag status\n` +
                    `> (groupStatusMentionMessage)\n\n` +
                    `\`\`\`━━━ ᴘɪʟɪʜᴀɴ ━━━\`\`\`\n` +
                    `> \`${prefix}${command} on\` → Aktifkan\n` +
                    `> \`${prefix}${command} off\` → Nonaktifkan`
                );
            }

            if (action === 'on') {
                db.setGroup(chatId, { ...groupData, antitagsw: 'on' });
                await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
                await reply(
                    `✅ *ᴀɴᴛɪᴛᴀɢsᴡ ᴀᴋᴛɪꜰ*\n\n` +
                    `> Anti tag status berhasil diaktifkan!\n` +
                    `> Pesan tag status akan dihapus otomatis.`
                );
                return;
            }

            if (action === 'off') {
                db.setGroup(chatId, { ...groupData, antitagsw: 'off' });
                await sock.sendMessage(chatId, { react: { text: '❌', key: m.key } });
                await reply(
                    `❌ *ᴀɴᴛɪᴛᴀɢsᴡ ɴᴏɴᴀᴋᴛɪꜰ*\n\n` +
                    `> Anti tag status berhasil dinonaktifkan.`
                );
                return;
            }
        }

        // Command: .antitoxic
        if (['antitoxic', 'toxic', 'antitoxik'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            const isOwner = config.isOwner(sender);
            if (!isSenderAdmin && !isOwner) return reply('❌ Perintah ini hanya untuk admin grup!');

            const subCommand = args[0]?.toLowerCase();
            const groupData = db.getGroup(chatId) || {};

            if (!subCommand) {
                const status = groupData.antitoxic ? '✅ ON' : '❌ OFF';
                const toxicCount = groupData.toxicWords?.length || DEFAULT_TOXIC_WORDS.length;
                const maxWarn = groupData.toxicMaxWarn || 3;
                const method = groupData.toxicMethod || 'kick';

                let txt = `🛡️ *ᴀɴᴛɪᴛᴏxɪᴄ*\n\n`
                txt += `> Status: *${status}*\n`
                txt += `> Kata: *${toxicCount}*\n`
                txt += `> Max Warn: *${maxWarn}*\n`
                txt += `> Metode: *${method}*\n\n`
                txt += `*Command:*\n`
                txt += `> \`${prefix}${command} on/off\`\n`
                txt += `> \`${prefix}${command} warn <1-10>\`\n`
                txt += `> \`${prefix}${command} metode kick/delete\`\n`
                txt += `> \`${prefix}addtoxic <kata>\`\n`
                txt += `> \`${prefix}deltoxic <kata>\`\n`
                txt += `> \`${prefix}listtoxic\``

                return reply(txt);
            }

            if (subCommand === 'on') {
                db.setGroup(chatId, { ...groupData, antitoxic: true });
                await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
                return reply(`✅ *Antitoxic diaktifkan*`);
            }

            if (subCommand === 'off') {
                db.setGroup(chatId, { ...groupData, antitoxic: false });
                await sock.sendMessage(chatId, { react: { text: '❌', key: m.key } });
                return reply(`❌ *Antitoxic dinonaktifkan*`);
            }

            if (subCommand === 'warn') {
                const count = parseInt(args[1]);
                if (!count || count < 1 || count > 10) {
                    return reply(`❌ Masukkan angka 1-10\n> Contoh: \`${prefix}${command} warn 5\``);
                }
                db.setGroup(chatId, { ...groupData, toxicMaxWarn: count });
                await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
                return reply(`✅ Max peringatan diubah ke *${count}*`);
            }

            if (['metode', 'method', 'mode'].includes(subCommand)) {
                const method = args[1]?.toLowerCase();
                if (!method || !['kick', 'delete'].includes(method)) {
                    return reply(`❌ Pilih metode: *kick* atau *delete*\n> Contoh: \`${prefix}${command} metode kick\``);
                }
                db.setGroup(chatId, { ...groupData, toxicMethod: method });
                await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
                return reply(`✅ Metode diubah ke *${method}*`);
            }
        }

        // Command: .addtoxic
        if (command === 'addtoxic') {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            const isOwner = config.isOwner(sender);
            if (!isSenderAdmin && !isOwner) return reply('❌ Perintah ini hanya untuk admin grup!');

            const word = args.join(' ').toLowerCase().trim();
            if (!word) return reply(`❌ Masukkan kata yang ingin ditambahkan.\n> Contoh: ${prefix}addtoxic kotor`);

            const groupData = db.getGroup(chatId) || {};
            const toxicWords = groupData.toxicWords || [...DEFAULT_TOXIC_WORDS];
            
            if (toxicWords.includes(word)) return reply('❌ Kata tersebut sudah ada di daftar.');

            toxicWords.push(word);
            db.setGroup(chatId, { ...groupData, toxicWords });
            return reply(`✅ Kata *${word}* berhasil ditambahkan ke daftar toxic grup.`);
        }

        // Command: .deltoxic
        if (command === 'deltoxic') {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            const isOwner = config.isOwner(sender);
            if (!isSenderAdmin && !isOwner) return reply('❌ Perintah ini hanya untuk admin grup!');

            const word = args.join(' ').toLowerCase().trim();
            if (!word) return reply('❌ Masukkan kata yang ingin dihapus.');

            const groupData = db.getGroup(chatId) || {};
            let toxicWords = groupData.toxicWords || [...DEFAULT_TOXIC_WORDS];

            if (!toxicWords.includes(word)) return reply('❌ Kata tersebut tidak ada di daftar.');

            toxicWords = toxicWords.filter(w => w !== word);
            db.setGroup(chatId, { ...groupData, toxicWords });
            return reply(`✅ Kata *${word}* berhasil dihapus dari daftar toxic grup.`);
        }

        // Command: .listtoxic
        if (command === 'listtoxic') {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            const groupData = db.getGroup(chatId) || {};
            const toxicWords = groupData.toxicWords || DEFAULT_TOXIC_WORDS;

            const list = toxicWords.map((w, i) => `${i + 1}. ${w}`).join('\n');
            return reply(`📋 *ᴅᴀꜰᴛᴀʀ ᴋᴀᴛᴀ ᴛᴏxɪᴄ*\n\n${list}`);
        }

        // Command: .autodl
        if (['autodl', 'autodownload'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            const isOwner = config.isOwner(sender);
            if (!isSenderAdmin && !isOwner) return reply('❌ Perintah ini hanya untuk admin grup!');

            const action = args[0]?.toLowerCase();
            const groupData = db.getGroup(chatId) || {};
            const current = groupData?.autodl || false;

            if (!action || action === 'status') {
                return reply(
                    `🔗 *ᴀᴜᴛᴏ ᴅᴏᴡɴʟᴏᴀᴅ*\n\n` +
                    `> Status: ${current ? '✅ Aktif' : '❌ Nonaktif'}\n\n` +
                    `*Platform Support:*\n` +
                    `> TikTok, Instagram, Facebook\n` +
                    `> YouTube, Twitter/X\n` +
                    `> Telegram, Discord\n\n` +
                    `*Penggunaan:*\n` +
                    `> \`${prefix}${command} on\` - Aktifkan\n` +
                    `> \`${prefix}${command} off\` - Nonaktifkan`
                );
            }

            if (action === 'on') {
                db.setGroup(chatId, { ...groupData, autodl: true });
                await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
                return reply(
                    `✅ *ᴀᴜᴛᴏ ᴅᴏᴡɴʟᴏᴀᴅ ᴀᴋᴛɪꜰ*\n\n` +
                    `> Kirim link sosmed dan bot akan auto download!\n` +
                    `> Support: TikTok, IG, FB, YouTube, Twitter/X`
                );
            }

            if (action === 'off') {
                db.setGroup(chatId, { ...groupData, autodl: false });
                await sock.sendMessage(chatId, { react: { text: '❌', key: m.key } });
                return reply(`❌ *ᴀᴜᴛᴏ ᴅᴏᴡɴʟᴏᴀᴅ ɴᴏɴᴀᴋᴛɪꜰ*`);
            }
            
            return reply(`❌ *ᴀʀɢᴜᴍᴇɴ ᴛɪᴅᴀᴋ ᴠᴀʟɪᴅ*\n\n> Gunakan: \`on\` atau \`off\``);
        }

        // Command: .autoforward
        if (['autoforward', 'autofw', 'autofwd'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            const isOwner = config.isOwner(sender);
            if (!isSenderAdmin && !isOwner) return reply('❌ Perintah ini hanya untuk admin grup!');

            const option = args[0]?.toLowerCase();
            const group = db.getGroup(chatId) || {};
            
            if (!option) {
                const status = group.autoforward ? '✅ ON' : '❌ OFF'
                return reply(
                    `🔄 *ᴀᴜᴛᴏ ꜰᴏʀᴡᴀʀᴅ*\n\n` +
                    `╭┈┈⬡「 📋 *ɪɴꜰᴏ* 」\n` +
                    `┃ ◦ Status: *${status}*\n` +
                    `╰┈┈⬡\n\n` +
                    `> Gunakan: \`${prefix}autoforward on/off\`\n\n` +
                    `_Fitur ini akan meneruskan semua pesan ke grup ini_`
                );
            }
            
            if (option === 'on') {
                db.setGroup(chatId, { ...group, autoforward: true });
                await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
                return reply(
                    `🔄 *ᴀᴜᴛᴏ ꜰᴏʀᴡᴀʀᴅ*\n\n` +
                    `╭┈┈⬡「 ✅ *ᴀᴋᴛɪꜰ* 」\n` +
                    `┃ ◦ Status: *ON*\n` +
                    `╰┈┈⬡\n\n` +
                    `> _Semua pesan akan di-forward ke grup ini_`
                );
            }
            
            if (option === 'off') {
                db.setGroup(chatId, { ...group, autoforward: false });
                await sock.sendMessage(chatId, { react: { text: '❌', key: m.key } });
                return reply(
                    `🔄 *ᴀᴜᴛᴏ ꜰᴏʀᴡᴀʀᴅ*\n\n` +
                    `╭┈┈⬡「 ❌ *ɴᴏɴᴀᴋᴛɪꜰ* 」\n` +
                    `┃ ◦ Status: *OFF*\n` +
                    `╰┈┈⬡`
                );
            }
            
            return reply(`❌ Gunakan: on atau off`);
        }

        // Command: .automedia
        if (['automedia', 'automedi', 'am'].includes(command || '')) {
            if (!isGroup) return reply('❌ Perintah ini hanya bisa dilakukan di dalam grup.');
            
            // Check admin
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => p.id === sender);
            const isSenderAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
            const isOwner = config.isOwner(sender);
            if (!isSenderAdmin && !isOwner) return reply('❌ Perintah ini hanya untuk admin grup!');

            const arg = args[0]?.toLowerCase();
            const groupData = db.getGroup(chatId) || {};
            const current = groupData.automedia ?? false;
            
            if (!arg) {
                const status = current ? '✅ Aktif' : '❌ Nonaktif';
                return reply(
                    `🎬 *ᴀᴜᴛᴏᴍᴇᴅɪᴀ*\n\n` +
                    `> Status: ${status}\n\n` +
                    `> Gunakan:\n` +
                    `> \`${prefix}automedia on\` - aktifkan\n` +
                    `> \`${prefix}automedia off\` - nonaktifkan\n\n` +
                    `> _Otomatis jadikan sticker jadi gambar_`
                );
            }
            
            if (arg === 'on') {
                if (current) return reply(`🎬 *ᴀᴜᴛᴏᴍᴇᴅɪᴀ*\n\n> Sudah aktif!`);
                db.setGroup(chatId, { automedia: true });
                await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } });
                return reply(`🎬 *ᴀᴜᴛᴏᴍᴇᴅɪᴀ*\n\n> ✅ Berhasil diaktifkan!\n> Sticker akan otomatis jadi gambar.`);
            }
            
            if (arg === 'off') {
                if (!current) return reply(`🎬 *ᴀᴜᴛᴏᴍᴇᴅɪᴀ*\n\n> Sudah nonaktif!`);
                db.setGroup(chatId, { automedia: false });
                await sock.sendMessage(chatId, { react: { text: '❌', key: m.key } });
                return reply(`🎬 *ᴀᴜᴛᴏᴍᴇᴅɪᴀ*\n\n> ❌ Berhasil dinonaktifkan!`);
            }
            
            return reply(`❌ Gunakan: \`${prefix}automedia on/off\``);
        }
    });

    // Request Pairing Code directly if phone provided
    if (phoneNumber && !sock.authState.creds.registered) {
        try {
            // Wait for internal state to be ready
            await new Promise(resolve => setTimeout(resolve, 3000));
            const code = await sock.requestPairingCode(phoneNumber);
            if (res && !res.headersSent) {
                res.json({ code, sessionId });
            }
        } catch (err: any) {
            console.error('Request pairing code error:', err);
            if (res && !res.headersSent) {
                res.status(500).json({ error: 'WhatsApp rejected the request. Please wait a few minutes and try again.' });
            }
        }
    }

    // Handle message updates for Anti-Remove
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            if (update.update.messageStubType === proto.WebMessageInfo.StubType.REVOKE) {
                const chatId = update.key.remoteJid || '';
                const db = getDatabase();
                const groupData = db.getGroup(chatId) || {};

                if (groupData.antiremove === 'on') {
                    const msgId = update.key.id || '';
                    const cached = messageCache.get(msgId);
                    
                    if (cached && cached.message) {
                        const sender = update.key.participant || update.key.remoteJid || '';
                        
                        await sock.sendMessage(chatId, { 
                            text: `🗑️ *ᴀɴᴛɪ ʀᴇᴍᴏᴠᴇ ᴅᴇᴛᴇᴄᴛᴇᴅ*\n\n` +
                                `👤 \`User:\` *@${sender.split('@')[0]}*\n` +
                                `🕒 \`Waktu:\` *${moment().tz('Asia/Jakarta').format('HH:mm:ss')}*\n` +
                                `🍀 \`Pesan:\` Terdeteksi menghapus pesan!`,
                            mentions: [sender]
                        }, { quoted: cached });

                        // Forward the original message content
                        await sock.sendMessage(chatId, { forward: cached });
                    }
                }
            }
        }
    });

    return sock;
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  
  app.use(express.json());

  // Log all requests for debugging
  app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
      console.log(`[REQ] ${req.method} ${req.url}`);
    }
    next();
  });

  // Cache for profile picture to prevent hitting rate limits
  let cachedProfilePicUrl: string | null | undefined = undefined; // undefined = not checked
  let isFetchingPp = false;

  // Direct API Routes (Highest Priority)
  app.get('/api/status', (req, res) => {
    console.log('[API] /api/status requested');
    res.setHeader('Content-Type', 'application/json');
    const memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    
    let userInfo = null;
    if (activeSocket?.user) {
        const jid = activeSocket.user.id.split(':')[0] + '@s.whatsapp.net';
        const rawName = activeSocket.user.name || activeSocket.authState?.creds?.me?.name || 'Bot User';
        
        // Fetch profile picture in background if not already cached
        if (cachedProfilePicUrl === undefined && !isFetchingPp) {
             isFetchingPp = true;
             // Attempt to get the picture, falling back to 'preview' resolution if 'image' is missing
             activeSocket.profilePictureUrl(jid, 'preview')
                 .catch(() => activeSocket.profilePictureUrl(jid, 'image').catch(() => null))
                 .then((url: string | null) => {
                     if (url) {
                        console.log(`[PP-API] Successfully fetched PP URL for ${jid}`);
                        cachedProfilePicUrl = url;
                     } else {
                        cachedProfilePicUrl = null;
                     }
                     isFetchingPp = false;
                 })
                 .catch((err: any) => {
                     const msg = err?.message || String(err);
                     // Suppress noisy errors for no PP or restricted privacy settings
                     if (!msg.includes('1006') && !msg.includes('404') && !msg.includes('401')) {
                         console.error(`PP error for ${jid}:`, msg);
                     }
                     
                     cachedProfilePicUrl = null; 
                     isFetchingPp = false;
                     // Retry after 2 minutes to avoid spamming while allowing recovery
                     setTimeout(() => { 
                         if (cachedProfilePicUrl === null) cachedProfilePicUrl = undefined; 
                     }, 120000);
                 });
        }

        userInfo = {
            id: activeSocket.user.id,
            name: rawName,
            profilePic: cachedProfilePicUrl
        };
    } else {
        cachedProfilePicUrl = undefined; // Reset cache when disconnected
    }

    res.json({ 
        connected: connectionStatus === 'connected',
        status: connectionStatus,
        sessionExists: fs.existsSync(path.join(sessionsDir, SESSION_ID)),
        memoryUsageMB: memoryMB,
        uptimeSeconds: process.uptime(),
        user: userInfo,
        metrics: {
            messagesProcessed,
            activeGroupsCount
        },
        logs: systemLogs
    });
  });

  // Health-check for 24/7 monitoring
  app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        uptime: process.uptime(),
        memory: process.memoryUsage().rss / 1024 / 1024,
        bot_connected: connectionStatus === 'connected'
    });
  });

  app.post('/api/pair', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });
    const phoneNumber = phone.replace(/[^0-9]/g, '');
    try {
      await connectToWhatsApp(SESSION_ID, phoneNumber, res);
    } catch (error) {
      console.error('Pairing error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  app.post('/api/logout', async (req, res) => {
    try {
      if (activeSocket) {
        try {
            await activeSocket.logout();
            activeSocket.end(undefined);
        } catch (e) {}
        activeSocket = null;
      }
      connectionStatus = 'disconnected';
      const sessionPath = path.join(sessionsDir, SESSION_ID);
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
      }
      res.json({ success: true });
    } catch (err) {
      console.error('Logout error:', err);
      res.status(500).json({ error: 'Failed to logout' });
    }
  });

  app.post('/api/reconnect', async (req, res) => {
    try {
      await connectToWhatsApp(SESSION_ID);
      res.json({ success: true });
    } catch (err) {
      console.error('Reconnect error:', err);
      res.status(500).json({ error: 'Failed to trigger reconnect' });
    }
  });

  app.get('/api/config', (req, res) => {
    try {
      const configPath = path.join(__dirname, 'config.json');
      let configData = {};
      if (fs.existsSync(configPath)) {
        configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
      
      const db = getDatabase();
      const settings = db.getSettings();
      
      res.json({
        ...configData,
        autoRead: settings.autoRead,
        autoTyping: settings.autoTyping
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to read config' });
    }
  });

  app.post('/api/config', (req, res) => {
    try {
      const { autoRead, autoTyping, ...rest } = req.body;
      
      const db = getDatabase();
      db.setSettings({ autoRead, autoTyping });
      
      fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(rest, null, 2));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

  // Handle undefined API routes
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // Global Error Handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('[GLOBAL-ERROR]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error', details: err?.message || String(err) });
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Start keep-alive pulse
    const selfUrl = `http://localhost:${PORT}/api/health`;
    startKeepAlive(selfUrl);
    
    // Auto reconnect on startup
    if (fs.existsSync(path.join(sessionsDir, SESSION_ID))) {
        console.log('Found existing session, reconnecting...');
        connectToWhatsApp(SESSION_ID).catch(err => {
            console.error('Auto-reconnect failed during startup:', err);
        });
    }
  });
}

startServer().catch(err => {
  console.error('CRITICAL: Failed to start server:', err);
  process.exit(1);
});
