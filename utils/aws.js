import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { config } from "../config.js";

const s3 = new S3Client({
  region: config.AWS_REGION,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  },
});

// Upload buffer to S3
export const uploadBufferToS3 = async (buffer, filename, contentType) => {
  const command = new PutObjectCommand({
    Bucket: config.AWS_S3_BUCKET_NAME,
    Key: filename,
    Body: buffer,
    ContentType: contentType,
  });

  return s3.send(command);
};

// Delete multiple files from S3
export const deleteMedias = async (files) => {
  if (!files.length) return;

  const command = new DeleteObjectsCommand({
    Bucket: config.AWS_S3_BUCKET_NAME,
    Delete: {
      Objects: files.map((key) => ({ Key: key })),
      Quiet: false,
    },
  });

  return s3.send(command);
};
