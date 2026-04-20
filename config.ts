import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'config.json');

const loadConfig = () => {
    try {
        const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return {
            owner: ['628123456789@s.whatsapp.net']
        };
    }
};

const configData = loadConfig();

const config = {
  get owner() { return loadConfig().owner; },
  isOwner: (jid: string) => config.owner.includes(jid),
  isPremium: (jid: string) => false,
};

export default config;
