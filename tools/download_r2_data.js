const fs = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

async function downloadFolder() {
    // 다운로드 받을 폴더 (기존 폴더와 섞이지 않게 data_downloaded에 저장)
    const dataDir = path.join(__dirname, '..', 'data_downloaded'); 
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

    console.log('R2 버킷에서 파일 목록을 가져옵니다...');
    let continuationToken = undefined;
    let totalDownloaded = 0;

    try {
        do {
            const listCmd = new ListObjectsV2Command({
                Bucket: process.env.R2_BUCKET_NAME,
                Prefix: 'data/',
                ContinuationToken: continuationToken,
            });

            const listRes = await r2.send(listCmd);

            for (const item of (listRes.Contents || [])) {
                const fileName = path.basename(item.Key);
                // 폴더 자체 객체거나 파일명이 없으면 건너뜀
                if (!fileName) continue; 
                
                const getCmd = new GetObjectCommand({
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: item.Key,
                });

                const data = await r2.send(getCmd);
                const content = await data.Body.transformToString();
                
                fs.writeFileSync(path.join(dataDir, fileName), content);
                totalDownloaded++;
                console.log(`[${totalDownloaded}] ${fileName} 다운로드 완료`);
            }

            continuationToken = listRes.NextContinuationToken;
        } while (continuationToken);

        console.log(`\n🎉 완료! 총 ${totalDownloaded}개의 파일이 'data_downloaded' 폴더에 다운로드되었습니다.`);
    } catch (e) {
        console.error(`다운로드 중 오류 발생:`, e);
    }
}

downloadFolder();
