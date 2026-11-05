const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

async function closeSite() {
    try {
        console.log('사이트를 종료 모드로 전환하기 위해 R2에 maintenance.json을 업로드합니다...');
        await r2.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: 'maintenance.json',
            Body: 'true', // JSON boolean true
            ContentType: 'application/json',
            CacheControl: 'no-store, no-cache, must-revalidate',
        }));
        console.log('✅ 사이트가 성공적으로 종료 모드로 전환되었습니다!');
    } catch (e) {
        console.error('❌ 종료 모드 전환 중 에러 발생:', e.message);
    }
}

closeSite();
