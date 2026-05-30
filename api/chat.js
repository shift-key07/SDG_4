// Vercel Serverless Function - OpenAI 연동 및 RAG(데이터 주입) 로직

const admin = require('firebase-admin');

// 로컬 개발 환경에서만 dotenv를 사용하여 .env 파일을 로드합니다.
// Vercel 환경에서는 자동으로 환경 변수가 주입되므로 dotenv가 필요하지 않습니다.
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// 0. Firebase Admin 초기화 (서버 콜드스타트 시 중복 초기화 방지)
if (!admin.apps.length && process.env.FIREBASE_PROJECT_ID) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // 중요: Vercel 환경변수에서 줄바꿈 문자(\n)가 깨지지 않도록 처리
                privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            })
        });
    } catch (error) {
        console.error('Firebase 초기화 에러:', error);
    }
}

const db = admin.apps.length ? admin.firestore() : null;

export default async function handler(req, res) {
    // POST 요청만 허용
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { message } = req.body;
    if (!message) {
        return res.status(400).json({ error: '메시지가 없습니다.' });
    }

    // 1. RAG(데이터 증강)를 위한 임시 SDG 4 데이터베이스
    // 추후 이 부분을 Firebase Firestore에서 데이터를 불러오는 로직으로 교체합니다.
    const sdgData = {
        "필리핀": "필리핀(PHL): 초등 교육 등록률 95%, 기초 학력 미달률 90%, 교육 예산은 GDP 대비 3.1%. 최근 기상 이변으로 학교 인프라 피해가 잦음.",
        "케냐": "케냐(KEN): 교사 1인당 학생 수가 40명을 넘으며, 북부 건조 지역의 교육 소외 현상이 심각함. 하지만 무료 초등 교육 도입 후 접근성은 향상됨.",
        "한국": "대한민국(KOR): 고등 교육 이수율 세계 최고 수준, 디지털 인프라 완비. 단, 사교육비 부담과 학업 스트레스가 높은 편임."
    };

    // 2. 사용자 질문 분석 및 타겟팅
    let targetCountry = "알 수 없음";
    let contextData = "전 세계적인 보편적 교육 동향을 바탕으로 일반적인 대답을 해줘.";
    let coordinates = null;

    if (message.includes("필리핀")) {
        targetCountry = "PHL";
        contextData = sdgData["필리핀"];
        coordinates = [12.87, 121.77];
    } else if (message.includes("케냐")) {
        targetCountry = "KEN";
        contextData = sdgData["케냐"];
        coordinates = [-1.29, 36.82];
    } else if (message.includes("한국") || message.includes("대한민국")) {
        targetCountry = "KOR";
        contextData = sdgData["한국"];
        coordinates = [35.90, 127.98];
    }

    // 3. OpenAI API 호출 준비 (환경 변수에서 API 키 로드)
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: '서버에 OpenAI API 키가 설정되지 않았습니다.' });
    }

    // AI에게 부여할 페르소나 및 주입할 데이터(프롬프트 엔지니어링)
    const systemPrompt = `너는 글로벌 교육 지표(SDG 4) 전문가야. 
    사용자의 질문에 친절하고 이해하기 쉽게 3~4문장으로 대답해줘. 
    반드시 다음 제공된 통계 데이터를 바탕으로 팩트만 말해야 해.
    [참고 데이터]: ${contextData}`;

    try {
        // 4. OpenAI 통신 (fetch API 사용)
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini", // 비용 효율이 좋은 모델 적용
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: message }
                ],
                temperature: 0.7
            })
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message);
        }

        const aiMessage = data.choices[0].message.content;

        // [추가된 부분] 4-1. Firebase Firestore에 대화 로그 저장
        if (db) {
            try {
                await db.collection('chat_logs').add({
                    user_message: message,
                    ai_reply: aiMessage,
                    target_country: targetCountry,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log("Firebase DB에 대화 로그 저장 성공!");
            } catch (dbError) {
                console.error("Firebase 저장 에러:", dbError);
                // DB 저장에 실패해도 사용자에게 AI 응답은 보내주기 위해 에러를 던지지 않음
            }
        }

        // 5. 프론트엔드로 최종 결과 전송
        return res.status(200).json({
            reply: aiMessage,
            countryCode: targetCountry,
            coordinates: coordinates
        });

    } catch (error) {
        console.error("OpenAI Error:", error);
        return res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다.' });
    }
}
