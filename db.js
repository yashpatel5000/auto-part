import mongoose from 'mongoose';
import { config } from "./config.js";
import logger from './utils/logger.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectDB = async (attempt = 1) => {
  try {
    if (mongoose.connection.readyState === 1) {
      return mongoose.connection.db;
    }
    const conn = await mongoose.connect(config.MONGO_URI);
    logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
    return conn.connection.db;
  } catch (error) {
    logger.error(`❌ MongoDB Error (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS);
      return connectDB(attempt + 1);
    }
    throw new Error(`MongoDB connection failed after ${MAX_RETRIES} attempts: ${error.message}`);
  }
};

export default connectDB;