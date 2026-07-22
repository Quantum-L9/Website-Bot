// L9_META: layer=runtime, role=budget_guard, status=active, version=2.0.0
import { createModuleLogger } from '../core/logger.js';
const logger=createModuleLogger('runtime:budget-guard');
/** AgentBudgetGuard: admission, reserve, reconcile, and enforce for one pipeline run. */
export class BudgetExceededError extends Error {}
export class AdmissionRejectedError extends Error {}
export type BudgetMode = 'normal' | 'cheaper_model' | 'narrow_scope' | 'require_approval' | 'stop';
export interface BudgetEnforcement { jobId:string; mode:BudgetMode; actualUsd:number; reservedUsd:number; remainingUsd:number; forecastUsd:number; }
export class AgentBudgetGuard {
  private actualUsd=0; private reservedUsd=0; private forecastUsd=0; private mode:BudgetMode='normal';
  constructor(public readonly jobId:string, private readonly capUsd:number, private readonly postgresUrl?:string) {}
  async open(initialForecastUsd=0):Promise<void>{ this.forecastUsd=initialForecastUsd; if(this.forecastUsd>this.capUsd) throw new AdmissionRejectedError(`Admission rejected: forecast $${this.forecastUsd.toFixed(4)} exceeds cap $${this.capUsd.toFixed(4)} for job ${this.jobId}`); }
  reserve(estimatedUsd:number):void{ const remaining=this.capUsd-this.actualUsd-this.reservedUsd; if(estimatedUsd>remaining){ this.updateMode(); const available=this.capUsd-this.actualUsd-this.reservedUsd; if(estimatedUsd>available) throw new BudgetExceededError(`Reservation denied: need $${estimatedUsd.toFixed(4)}, remaining $${available.toFixed(4)}, mode=${this.mode}, job=${this.jobId}`); } this.reservedUsd+=estimatedUsd; this.forecastUsd=this.actualUsd+this.reservedUsd; }
  reconcile(actualUsd:number,nextEstimateUsd=0):void{ this.actualUsd+=actualUsd; this.reservedUsd=Math.max(0,this.reservedUsd-actualUsd); this.forecastUsd=this.actualUsd+this.reservedUsd+nextEstimateUsd; if(this.actualUsd>this.capUsd) throw new BudgetExceededError(`Budget cap $${this.capUsd.toFixed(4)} exceeded: actual=$${this.actualUsd.toFixed(4)}, job=${this.jobId}`); if(this.forecastUsd>this.capUsd) this.updateMode(); }
  enforce():BudgetEnforcement{ const remaining=this.capUsd-this.actualUsd; if(remaining<=0){ this.mode='stop'; throw new BudgetExceededError(`Cap exhausted for job ${this.jobId}: actual=$${this.actualUsd.toFixed(4)}, cap=$${this.capUsd.toFixed(4)}`); } return {jobId:this.jobId,mode:this.mode,actualUsd:this.actualUsd,reservedUsd:this.reservedUsd,remainingUsd:remaining,forecastUsd:this.forecastUsd}; }
  async close():Promise<void>{ if(!this.postgresUrl) return; try{ const {default:pg}=await import('pg'); const client=new pg.Client({connectionString:this.postgresUrl}); await client.connect(); await client.query(`UPDATE agent_jobs SET cost_usd = $2, status = CASE WHEN status = 'running' THEN 'success' ELSE status END WHERE job_id = $1`,[this.jobId,this.actualUsd]); await client.end(); }catch(error){ logger.error({jobId:this.jobId,error:error instanceof Error?error.message:String(error)},'Budget persistence failed'); } }
  get currentMode():BudgetMode{return this.mode;}
  private updateMode():void{ const pressure=this.capUsd===0?1:(this.actualUsd+this.reservedUsd)/this.capUsd; if(pressure<0.70)this.mode='normal'; else if(pressure<0.85)this.mode='cheaper_model'; else if(pressure<0.95)this.mode='narrow_scope'; else if(pressure<1)this.mode='require_approval'; else this.mode='stop'; }
}
