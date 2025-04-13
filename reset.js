import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Set up directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File paths
const PROCESSED_IDS_FILE = path.join(__dirname, 'processed_ids.json');
const STATE_FILE = path.join(__dirname, 'bot_state.json');

// Delete the state files if they exist
function resetBotState() {
  console.log('Resetting bot state...');
  
  let resetOccurred = false;
  
  // Try to delete processed IDs file
  if (fs.existsSync(PROCESSED_IDS_FILE)) {
    try {
      fs.unlinkSync(PROCESSED_IDS_FILE);
      console.log(`Deleted ${PROCESSED_IDS_FILE}`);
      resetOccurred = true;
    } catch (error) {
      console.error(`Error deleting ${PROCESSED_IDS_FILE}:`, error);
    }
  } else {
    console.log(`${PROCESSED_IDS_FILE} does not exist, no need to delete`);
  }
  
  // Try to delete state file
  if (fs.existsSync(STATE_FILE)) {
    try {
      fs.unlinkSync(STATE_FILE);
      console.log(`Deleted ${STATE_FILE}`);
      resetOccurred = true;
    } catch (error) {
      console.error(`Error deleting ${STATE_FILE}:`, error);
    }
  } else {
    console.log(`${STATE_FILE} does not exist, no need to delete`);
  }
  
  if (resetOccurred) {
    console.log('Bot state has been reset. The bot will start fresh on next run.');
  } else {
    console.log('No state files found. Bot is already in a fresh state.');
  }
}

// Run the reset
resetBotState(); 