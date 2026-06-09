export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ error: '텍스트가 없습니다.' });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: '서버에 OpenAI API 키가 설정되지 않았습니다.' });
    }

    try {
        // OpenAI TTS API 호출
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'tts-1', // 속도가 빠른 모델 (고음질은 tts-1-hd)
                voice: 'nova',  // 매우 자연스럽고 부드러운 여성 목소리 (alloy, echo, fable, onyx, nova, shimmer 중 선택 가능)
                input: text
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI TTS Error: ${response.statusText}`);
        }

        // 오디오 데이터를 버퍼로 변환하여 프론트엔드에 전달
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 헤더를 오디오 파일(MP3) 형식으로 맞춤
        res.setHeader('Content-Type', 'audio/mpeg');
        res.status(200).send(buffer);

    } catch (error) {
        console.error("TTS 연동 에러:", error);
        return res.status(500).json({ error: '음성 생성 중 오류가 발생했습니다.' });
    }
}
