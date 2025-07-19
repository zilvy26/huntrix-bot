const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Load env
require('dotenv').config();

const useS3 = process.env.STORAGE_MODE === 's3';

let s3;
if (useS3) {
  s3 = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    forcePathStyle: true, // needed for Hetzner-style S3
  });
}

async function saveImage(filename, buffer) {
  if (!useS3) {
    const savePath = path.join('/root/images', filename);
    fs.writeFileSync(savePath, buffer);
    return `http://${process.env.SERVER_PUBLIC_IP}/images/${filename}`;
  } else {
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: filename,
      Body: buffer,
      ACL: 'public-read', // make sure files are accessible
    });

    await s3.send(command);
    return `${process.env.S3_PUBLIC_URL}/${filename}`;
  }
}

module.exports = {
  saveImage
};