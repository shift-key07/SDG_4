// Firebase Admin SDK 관련 코드를 모두 삭제하여 서버를 가볍게 만들었습니다!
const sdgData = require('../data/sdg4_data.json'); 

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { message } = req.body;
    if (!message) {
        return res.status(400).json({ error: '메시지가 없습니다.' });
    }

    // 2. 사용자 질문에서 국가 이름 매칭 (RAG 핵심)
    let targetCountry = "알 수 없음";
    let targetData = null;

    for (const country_en of Object.keys(sdgData)) {
        if (message.toLowerCase().includes(country_en.toLowerCase())) {
            targetCountry = country_en;
            targetData = sdgData[country_en];
            break;
        }
    }

    // 3. AI 프롬프트 조립 (5가지 핵심 데이터를 모두 주입)
    let contextData = "";
    let coordinates = null;

    if (targetData) {
        contextData = `[${targetCountry} 팩트 데이터 (출처: SDG 4 Kaggle Data)]
- 학습 빈곤율(문맹률): ${targetData.illiteracy_rate}
- 학교 전력 보급률: ${targetData.school_electricity}
- 학교 밖 아동 비율: ${targetData.out_of_school_rate}
- 초등학교 졸업률: ${targetData.primary_completion_rate}
- 읽기 이해도: ${targetData.reading_comprehension}
- 교사 1인당 학생 수: ${targetData.pupil_teacher_ratio}

이 6가지 통계를 유기적으로 연결해서 이 국가의 교육 현실(접근성, 인프라, 학습결과)을 4~5문장으로 깊이 있게 분석해줘.`;
        coordinates = targetData.coordinates;
    } else {
        contextData = "질문한 국가의 구체적인 통계 데이터가 없습니다. 글로벌 교육(SDG 4)의 일반적인 관점에서 대답해주세요.";
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: '서버에 OpenAI API 키가 설정되지 않았습니다.' });
    }

    const systemPrompt = `너는 글로벌 교육 지표(SDG 4) 전문가야. 
반드시 제공된 [팩트 데이터] 수치를 명시하며, 원인과 결과를 분석하는 통찰력 있는 답변을 제공해.`;

    try {
        // OpenAI 통신
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `사용자 질문: ${message}\n\n${contextData}` }
                ],
                temperature: 0.7
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const aiMessage = data.choices[0].message.content;

        // 🔥 백엔드에서 chat_logs에 저장하던 부분 완전히 삭제됨 🔥
        // 이제 프론트엔드가 users 폴더에 알아서 저장합니다!

        return res.status(200).json({
            reply: aiMessage,
            countryCode: targetData ? targetData.country_code : "UNKNOWN",
            coordinates: coordinates
        });

    } catch (error) {
        console.error("OpenAI Error:", error);
        return res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다.' });
    }
}
