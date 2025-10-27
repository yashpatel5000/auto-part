import mongoose from 'mongoose';
import { config } from "./config.js";
import logger from './utils/logger.js';

const connectDB = async () => {
    try {
      const conn = await mongoose.connect(config.MONGO_URI);
      logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
      return conn.connection.db;;
    } catch (error) {
      logger.error(`❌ MongoDB Error: ${error.message}`);
      process.exit(1); // Stop the app if DB connection fails
    }
};
  
export default connectDB;