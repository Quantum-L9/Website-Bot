// Temporary stub for @quantum-l9/llm-router to enable testing

export class BudgetExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExhaustedError';
  }
}

export class L9LLMRouter {
  constructor(config: any) {}
  
  initClient(clientId: string) {
    // Stub implementation
  }
  
  async execute(task: TaskDescriptor, systemPrompt?: string, userPrompt?: string): Promise<LLMResponse> {
    return {
      content: 'Stub response - LLM Router not available',
      model: 'stub',
      inputTokens: 10,
      outputTokens: 20,
      cost: 0.001
    };
  }
}

export enum TaskComplexity {
  LOW = 'low',
  MEDIUM = 'medium', 
  HIGH = 'high'
}

export enum TaskType {
  CONTENT_GENERATION = 'content_generation',
  STRATEGIC_REASONING = 'strategic_reasoning',
  CODE_GENERATION = 'code_generation'
}

export interface LLMResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface TaskDescriptor {
  clientId: string;
  type: TaskType;
  complexity: TaskComplexity;
  description: string;
  expectedOutputTokens?: number;
  requiresReasoning?: boolean;
}