import mongoose from 'mongoose';

const connectDB = async () => {
    try {
      const conn = await mongoose.connect(process.env.MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
      return conn.connection.db;;
    } catch (error) {
      console.error(`❌ MongoDB Error: ${error.message}`);
      process.exit(1); // Stop the app if DB connection fails
    }
};
  
export default connectDB;