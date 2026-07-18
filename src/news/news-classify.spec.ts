import { classifyCross } from './news-classify';

describe('classifyCross（FR-006/027, US1-7）', () => {
  it('前後端相關項一律歸單一 frontend-backend 桶（不細分 backend/frontend）', () => {
    expect(classifyCross('New React 19 features you should know')).toBe('frontend-backend');
    expect(classifyCross('FastAPI performance tuning with Python')).toBe('frontend-backend');
    expect(classifyCross('Node.js streams explained')).toBe('frontend-backend');
  });

  it('保留 devops 桶', () => {
    expect(classifyCross('Kubernetes 1.30 release highlights')).toBe('devops');
    expect(classifyCross('GitOps with Terraform and Helm')).toBe('devops');
  });

  it('AI 最高優先序（多桶命中時擇 AI）', () => {
    expect(classifyCross('Running LLM agents inside Docker containers')).toBe('ai');
  });

  it('無任一命中 → null（離題排除，寧缺勿濫）', () => {
    expect(classifyCross('My favorite coffee brewing recipes')).toBeNull();
  });

  it('小寫詞界比對避免子字串誤命中', () => {
    expect(classifyCross('Email marketing basics for startups')).toBeNull(); // 'ai' 不誤命中 email
    expect(classifyCross('Training your dog with patience')).toBeNull(); // 'ai' 不誤命中 training
  });
});
