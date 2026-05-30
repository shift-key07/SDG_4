const admin = require('firebase-admin');
// 1. 방금 만든 막강한 전체 국가 JSON 데이터 불러오기!
const sdgData = require('../data/sdg4_data.json'); 

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// Firebase Admin 초기화 (서버 콜드스타트 시 중복 초기화 방지)
if (!admin.apps.length && process.env.FIREBASE_PROJECT_ID) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            })
        });
    } catch (error) {
        console.error('Firebase 초기화 에러:', error);
    }
}

const db = admin.apps.length ? admin.firestore() : null;

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

    // Object.keys를 이용해 sdgData.json에 있는 국가 이름(영어) 확인
    // 참고: 사용자가 한국어로 질문할 경우를 대비한 번역 로직 추가 가능하지만, 
    // 우선 데이터에 있는 영문 국가명이 질문에 포함되었는지 체크합니다.
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

        // Firebase Firestore에 대화 로그 저장
        if (db) {
            try {
                await db.collection('chat_logs').add({
                    user_message: message,
                    ai_reply: aiMessage,
                    target_country: targetCountry,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (dbError) {
                console.error("Firebase 저장 에러:", dbError);
            }
        }

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
