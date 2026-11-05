const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

async function uploadLocalData() {
    const dataDir = path.join(__dirname, '..', 'data');
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));

    console.log(`${files.length}개의 데이터 파일을 R2에 업로드합니다...`);

    let uploaded = 0;
    let skipped = 0;

    for (const file of files) {
        const filePath = path.join(dataDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        try {
            const data = JSON.parse(content);
            // 소멸된 영상(deleteDate가 과거)이 포함된 파일만 업로드
            const vods = data.streamer?.vods || [];
            const hasDeletedVods = vods.some(v => {
                const t = new Date(v.deleteDate?.replace(' ', 'T')).getTime();
                return !isNaN(t) && t < Date.now();
            });

            if (!hasDeletedVods) {
                skipped++;
                continue;
            }

            await r2.send(new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: `data/${file}`,
                Body: content,
                ContentType: 'application/json',
            }));
            uploaded++;
            console.log(`[${uploaded}] ${file} 업로드 완료 (소멸 VOD ${vods.filter(v => { const t = new Date(v.deleteDate?.replace(' ', 'T')).getTime(); return !isNaN(t) && t < Date.now(); }).length}개)`);
        } catch (e) {
            console.error(`[오류] ${file}: ${e.message}`);
        }
    }

    console.log(`\n완료! 업로드: ${uploaded}개, 스킵(소멸 VOD 없음): ${skipped}개`);
}

uploadLocalData();
