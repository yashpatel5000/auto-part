// logger.js
import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";


const logFormat = format.printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : "";
  return `${timestamp} [${level}]: ${stack || message} ${metaStr}`;
});


const dailyRotateTransport = new DailyRotateFile({
  filename: "logs/%DATE%-combined.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  level: "info",
});

const errorRotateTransport = new DailyRotateFile({
  filename: "logs/%DATE%-error.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  level: "error",
});

const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    logFormat
  ),
  transports: [dailyRotateTransport, errorRotateTransport],
});

logger.add(
  new transports.Console({
    format: format.combine(format.colorize(), logFormat),
  })
);

export default logger;
