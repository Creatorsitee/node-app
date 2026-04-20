import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(process.cwd(), 'database.json');

interface GroupData {
    antilinkList?: string[];
    antilinkActive?: boolean;
    toxicWords?: string[];
    antitoxicActive?: boolean;
    antibot?: boolean;
    antidocument?: boolean;
    antilinkall?: 'on' | 'off';
    antilinkallMode?: 'kick' | 'remove';
    antilinkgc?: 'on' | 'off';
    antilinkgcMode?: 'kick' | 'remove';
    antimedia?: boolean;
    [key: string]: any;
}

interface DatabaseSchema {
    groups: { [jid: string]: GroupData };
    users: { [jid: string]: any };
    stickerCommands: { [hash: string]: string };
    settings: {
        autoRead: boolean;
        autoTyping: boolean;
        [key: string]: any;
    };
}

let db: DatabaseSchema = {
    groups: {},
    users: {},
    stickerCommands: {},
    settings: {
        autoRead: false,
        autoTyping: false
    }
};

// Auto load
if (fs.existsSync(DB_PATH)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    } catch (e) {
        console.error('Failed to load database:', e);
    }
}

const save = () => {
    try {
        fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), (err) => {
            if (err) console.error('Failed to save database:', err);
        });
    } catch (e) {
        console.error('Failed to initiate database save:', e);
    }
};

export const getDatabase = () => {
    return {
        getGroup: (jid: string) => db.groups[jid] || {},
        setGroup: (jid: string, data: Partial<GroupData>) => {
            db.groups[jid] = { ...(db.groups[jid] || {}), ...data };
            save();
        },
        getUser: (jid: string) => db.users[jid] || {},
        setUser: (jid: string, data: any) => {
            db.users[jid] = { ...(db.users[jid] || {}), ...data };
            save();
        },
        getSettings: () => db.settings || { autoRead: false, autoTyping: false },
        setSettings: (data: Partial<DatabaseSchema['settings']>) => {
            db.settings = { ...(db.settings || { autoRead: false, autoTyping: false }), ...data };
            save();
        },
        data: db
    };
};
