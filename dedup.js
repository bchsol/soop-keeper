const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'streamers.txt');

if (fs.existsSync(filePath)) {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    const seen = new Set();
    const uniqueLines = [];
    
    for (const line of lines) {
        const lower = line.toLowerCase();
        if (!seen.has(lower)) {
            seen.add(lower);
            uniqueLines.push(line);
        }
    }
    
    // 파일에 다시 덮어쓰기 (줄바꿈 문자는 운영체제 호환성을 고려해 \n으로 통일)
    fs.writeFileSync(filePath, uniqueLines.join('\n') + '\n', 'utf-8');
    console.log(`[성공] streamers.txt 중복 제거 완료!`);
    console.log(`원래 아이디 수: ${lines.length}개 -> 변경 후 아이디 수: ${uniqueLines.length}개`);
} else {
    console.error('[오류] streamers.txt 파일을 찾을 수 없습니다.');
}
