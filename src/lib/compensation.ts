// L9_META: layer=runtime, role=compensation_registry, status=active, version=2.0.0
import { createModuleLogger } from '../core/logger.js';
const logger=createModuleLogger('runtime:compensation');
export interface CompensationEntry { stepId:string; action:()=>Promise<void>; registeredAt:Date; }
export class CompensationRegistry {
  private readonly entries:CompensationEntry[]=[];
  constructor(public readonly jobId:string){}
  register(stepId:string,action:()=>Promise<void>):void{this.entries.push({stepId,action,registeredAt:new Date()});}
  async compensate():Promise<Array<{stepId:string;error?:string}>>{const results:Array<{stepId:string;error?:string}>=[]; for(const entry of [...this.entries].reverse()){try{await entry.action();results.push({stepId:entry.stepId});logger.info({jobId:this.jobId,stepId:entry.stepId},'Compensation completed');}catch(error){const message=error instanceof Error?error.message:String(error);results.push({stepId:entry.stepId,error:message});logger.error({jobId:this.jobId,stepId:entry.stepId,error:message},'Compensation failed');}} return results;}
  clear():void{this.entries.length=0;}
  get size():number{return this.entries.length;}
}
