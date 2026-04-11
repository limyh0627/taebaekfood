import { GoogleGenAI } from "@google/genai";
import { Order, Product } from "./types";

// Business insights function using Gemini 3 Pro for complex reasoning tasks
export const getBusinessInsights = async (orders: Order[], products: Product[]) => {
  // Always initialize GoogleGenAI inside the function to ensure up-to-date API key usage
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = 'gemini-3-pro-preview';
  
  const salesSummary = orders.reduce((acc, order) => {
    acc.totalSales += order.totalAmount;
    acc.count += 1;
    return acc;
  }, { totalSales: 0, count: 0 });

  const lowStockProducts = products.filter(p => p.stock < 10);
  const lowStockComponents = products.flatMap(p => p.submaterials || [])
    .filter(c => c.stock < 20);

  const prompt = `
    다음은 현재 비즈니스 데이터 요약입니다:
    - 총 주문 수: ${salesSummary.count}
    - 총 매출액: ${salesSummary.totalSales.toLocaleString()}원
    - 완제품 재고 부족: ${lowStockProducts.map(p => p.name).join(', ')}
    - 부자재(용기, 뚜껑 등) 재고 부족: ${lowStockComponents.map(c => c.name).join(', ')}
    
    최근 주문 내역:
    ${JSON.stringify(orders.slice(-5))}

    이 데이터를 바탕으로 비즈니스 성과를 분석하고, 특히 "부자재 재고"가 완제품 생산에 미치는 영향을 고려하여 3가지 구체적인 전략을 제안해주세요. 
    답변은 한국어로, 정중하고 전문적인 톤으로 작성해주세요.
    마크다운 형식을 사용하세요.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    // Directly access the .text property
    return response.text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "AI 분석을 가져오는 중 오류가 발생했습니다.";
  }
};

// Simple chat assistant function using Gemini 3 Flash
export const chatWithAI = async (message: string, context: { orders: Order[], products: Product[] }) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = 'gemini-3-flash-preview';
  
  try {
    const response = await ai.models.generateContent({
      model,
      contents: `
        비즈니스 관리 보조 AI입니다. 
        현재 데이터 상황: 
        주문 수: ${context.orders.length}, 
        상품 수: ${context.products.length}
        부자재 관리 기능이 추가되어 완제품 생산 가능 여부를 판단할 수 있습니다.
        
        사용자 질문: ${message}
        
        질문에 대해 비즈니스 데이터와 부자재 현황을 참고하여 유용한 조언을 해주세요.
      `,
    });
    
    // Directly access the .text property
    return response.text;
  } catch (error) {
    console.error("Gemini API Chat Error:", error);
    return "AI와 대화 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }
};
