import { bitable, FieldType } from '@lark-base-open/js-sdk';
import type { IDateTimeField, INumberField, ISingleLinkField, ISingleSelectField, ITextField, IUserField } from '@lark-base-open/js-sdk';

// Field/table names and types verified against 金属表面处理生产管理系统 (6).base.
const UNIT_TABLE = '周转单位表';
const LOG_TABLE = '工艺卡打印记录表';
const UNIT_STATUS = '工艺卡打印状态';
const UNIT_TIME = '工艺卡打印时间';
const UNIT_COUNT = '工艺卡打印次数';
const UNIT_CODE = '周转单位编号';
const LOG_LINK = '关联周转单位';
const LOG_TIME = '打印时间';
const LOG_TYPE = '打印类型';
const LOG_STATUS = '打印状态';
const LOG_NOTE = '备注';
const LOG_OPERATOR = '打印人';
// Editable, immutable per-event checkpoint. The linked '打印次数' is only a live display.
const LOG_TARGET_COUNT = '同步目标次数';
const MARKER = 'ERP-PRINT-JOB:';

export type PrintHistoryRecord = {
  id: string; unitId: string; label: string; time: number;
  kind: string; status: string; note: string; targetCount: number;
};
export type PrintWriteResult = { success: string[]; failed: Array<{ id: string; reason: string }> };

type Snapshot = {
  unit: Awaited<ReturnType<typeof bitable.base.getTable>>;
  log: Awaited<ReturnType<typeof bitable.base.getTable>>;
  unitFields: Record<string, string>;
  logFields: Record<string, string>;
};
function assertField(meta: Array<{id:string;name:string;type:FieldType}>, name:string, type:FieldType):string {
  const field = meta.find(x => x.name === name);
  if (!field || field.type !== type) throw new Error(`字段结构不匹配：${name}（请核对 Base 表格和字段类型）`);
  return field.id;
}
async function schema():Promise<Snapshot> {
  const unit = await bitable.base.getTable(UNIT_TABLE);
  const log = await bitable.base.getTable(LOG_TABLE);
  const [u,l] = await Promise.all([unit.getFieldMetaList(),log.getFieldMetaList()]);
  return {unit,log,unitFields: {
    status:assertField(u,UNIT_STATUS,FieldType.SingleSelect),
    time:assertField(u,UNIT_TIME,FieldType.DateTime),
    count:assertField(u,UNIT_COUNT,FieldType.Number),
    label:assertField(u,UNIT_CODE,(20 as FieldType))
  }, logFields:{
    link:assertField(l,LOG_LINK,(21 as FieldType)),
    time:assertField(l,LOG_TIME,FieldType.DateTime),
    kind:assertField(l,LOG_TYPE,FieldType.SingleSelect),
    status:assertField(l,LOG_STATUS,FieldType.SingleSelect),
    note:assertField(l,LOG_NOTE,FieldType.Text),
    operator:assertField(l,LOG_OPERATOR,FieldType.User),
    target:assertField(l,LOG_TARGET_COUNT,FieldType.Number)
  }};
}
function n(value: unknown):number { const num=Number(value);return Number.isFinite(num)?num:0; }
function checked(value:boolean | void, label:string):void {
  if (value===false) throw new Error(`${label}写入失败`);
}
function marker(jobId:string, recordId:string):string {return `${MARKER}${jobId}:${recordId}`;}
function targetFromNote(note:string):number {
  const m=/目标次数=(\d+)/.exec(note);return m?Number(m[1]):0;
}
async function readLogs(s:Snapshot):Promise<PrintHistoryRecord[]> {
  const ids=await s.log.getRecordIdList();
  const linkField=await s.log.getField<ISingleLinkField>(s.logFields.link);
  const rows:PrintHistoryRecord[]=[];
  for (let offset=0;offset<ids.length;offset+=8) {
    const group=await Promise.all(ids.slice(offset,offset+8).map(async id=> {
      try {
        const [link,time,kind,status,note,targetCount]=await Promise.all([
          linkField.getValue(id),
          s.log.getCellValue(s.logFields.time,id),
          s.log.getCellString(s.logFields.kind,id),
          s.log.getCellString(s.logFields.status,id),
          s.log.getCellString(s.logFields.note,id),
          s.log.getCellValue(s.logFields.target,id)
        ]);
        return {id,unitId:link?.recordIds?.[0]||'',label:'',time:n(time),kind:kind.trim(),status:status.trim(),note:note.trim(),targetCount:n(targetCount)};
      } catch(e) {throw new Error(`打印日志读取失败（${id}）：${e instanceof Error?e.message:String(e)}。已停止写入，避免重复记录`);}
    }));
    for (const r of group) if(r)rows.push(r);
  }
  return rows;
}
export async function getPrintHistory():Promise<PrintHistoryRecord[]> {
  const s=await schema();const rows=await readLogs(s);
  const labelById=new Map<string,string>();
  for (const id of [...new Set(rows.map(r=>r.unitId).filter(Boolean))]) {
    try{labelById.set(id,(await s.unit.getCellString(s.unitFields.label,id)).trim()||id);}
    catch{labelById.set(id,id);}
  }
  return rows.map(r=>({...r,label:labelById.get(r.unitId)||'关联记录未找到'}))
    .sort((a,b)=>b.time-a.time||b.id.localeCompare(a.id));
}

// Read-only reconciliation of the exact saved job. A matching history entry is
// NOT itself a failure: it may represent a completed confirmation whose local
// bridge cleanup failed. Never create or update rows during this inspection.
export type PendingCheck = { id: string; state: 'completed' | 'unwritten' | 'needsResume' | 'unsafe'; details: string };
export async function inspectPendingPrintJob(ids: string[], jobId: string): Promise<PendingCheck[]> {
  if (!jobId || !ids.length) throw new Error('待核对打印任务不完整');
  const s = await schema();
  const events = await readLogs(s);
  const results: PendingCheck[] = [];
  for (const id of [...new Set(ids)]) {
    const key = marker(jobId, id);
    const matching = events.filter(x => x.note === key || x.note.startsWith(`${key} |`));
    if (matching.length > 1) {
      results.push({id, state:'unsafe', details:'同一任务发现多条打印日志，需要人工核对'});
      continue;
    }
    const [status, countRaw, timeRaw] = await Promise.all([
      s.unit.getCellString(s.unitFields.status,id),
      s.unit.getCellValue(s.unitFields.count,id),
      s.unit.getCellValue(s.unitFields.time,id)
    ]);
    const count = n(countRaw), stamp = n(timeRaw);
    const event = matching[0];
    if (!event) {
      const clean = status.trim() === '未打印' && count === 0 && stamp === 0;
      results.push({id, state:clean ? 'unwritten' : 'unsafe',
        details:clean ? '未找到任务日志，打印状态/次数/时间均未写入' : '无任务日志，但打印数据不为空；可能存在其他任务或历史打印'});
      continue;
    }
    if (event.unitId !== id) {
      results.push({id, state:'unsafe', details:`打印日志 ${event.id} 的关联周转单位不匹配`});
      continue;
    }
    const target = event.targetCount || targetFromNote(event.note);
    if (!target || !event.time) {
      results.push({id, state:'unsafe', details:`日志 ${event.id} 缺少同步目标次数或打印时间`});
      continue;
    }
    const complete = event.status === '已打印' && status.trim() === '已打印'
      && count >= target && Math.abs(stamp - event.time) <= 1000;
    results.push({id, state: complete ? 'completed' : 'needsResume',
      details: complete ? `已完成同步（日志 ${event.id}，次数 ${target}）`
        : `日志 ${event.id} 已创建，但打印状态/次数/时间未全部匹配；请使用原任务继续同步`});
  }
  return results;
}

// Compatibility for previous callers: only completely untouched FIRST PRINTS
// may be dropped, otherwise preserve the saved job for recovery.
export async function verifyPendingCanBeReleased(ids: string[], jobId: string): Promise<void> {
  const results = await inspectPendingPrintJob(ids, jobId);
  const blocked = results.find(x => x.state !== 'unwritten');
  if (blocked) throw new Error(`${blocked.id}: ${blocked.details}`);
}

// Manual late confirmation is permitted only for a unit with no prior print event.
// Operators must attest that a physical card already exists. This must never
// silently become a reprint or bypass a previous, partially written event.
export async function verifyManualLateConfirmation(id: string): Promise<void> {
  const s = await schema();
  const logs = await readLogs(s);
  if (logs.some(row => row.unitId === id)) {
    throw new Error('该周转单位已有打印日志，不能作为首次打印进行人工补确认；请使用打印历史中的重新打印');
  }
  const [status, count, timestamp] = await Promise.all([
    s.unit.getCellString(s.unitFields.status, id),
    s.unit.getCellValue(s.unitFields.count, id),
    s.unit.getCellValue(s.unitFields.time, id)
  ]);
  if (status.trim() !== '未打印' || n(count) !== 0 || n(timestamp) !== 0) {
    throw new Error('打印状态、次数或时间已发生变化；为了防止重复确认，已停止人工补确认');
  }
}

// Log FIRST, metadata SECOND, status LAST. Never infer printing from a closed dialog.
// Each retry uses a stable job ID and looks for its existing log row.
// Feishu multi-table writes are NOT atomic. Concurrent devices still require
// a server-side unique idempotency key for strict exactly-once guarantees.
export async function confirmPrintedRecords(ids:string[], jobId:string, operator:string, source: 'preview' | 'manual' = 'preview'):Promise<PrintWriteResult> {
  if(!jobId.trim())throw new Error('打印确认批次编号缺失');
  const s=await schema();
  if(!/^ou_[A-Za-z0-9]+$/.test(operator)) throw new Error('无法识别打印人 Open ID，请检查飞书登录用户身份');
  const [statusField,timeField,countField,linkField,logTime,logType,logStatus,logNote,logOperator,logTarget]=await Promise.all([
    s.unit.getField<ISingleSelectField>(s.unitFields.status),
    s.unit.getField<IDateTimeField>(s.unitFields.time),
    s.unit.getField<INumberField>(s.unitFields.count),
    s.log.getField<ISingleLinkField>(s.logFields.link),
    s.log.getField<IDateTimeField>(s.logFields.time),
    s.log.getField<ISingleSelectField>(s.logFields.kind),
    s.log.getField<ISingleSelectField>(s.logFields.status),
    s.log.getField<ITextField>(s.logFields.note),
    s.log.getField<IUserField>(s.logFields.operator),
    s.log.getField<INumberField>(s.logFields.target)
  ]);
  const opts=await Promise.all([statusField.getOptions(),logType.getOptions(),logStatus.getOptions()]);
  if(!opts[0].some(x=>x.name==='已打印')||!opts[1].some(x=>x.name==='首次打印')||!opts[1].some(x=>x.name==='重新打印')||!opts[2].some(x=>x.name==='已打印'))throw new Error('打印状态/类型选项不匹配');
  const existing=await readLogs(s);
  const result:PrintWriteResult={success:[],failed:[]};
  for(const id of [...new Set(ids)]) {
    const key=marker(jobId,id);
    try {
      let log=existing.find(x => x.note === key || x.note.startsWith(`${key} |`));
      // Prefer the immutable technical number. Old log rows still support legacy remarks.
      let target=log?.targetCount || targetFromNote(log?.note||'');
      let stamp=log?.time||Date.now();
      if(!log) {
        const [oldStatus,oldCount]=await Promise.all([statusField.getValue(id),countField.getValue(id)]);
        const previous=n(oldCount);
        target=previous+1;
        const kind=oldStatus?.text==='已打印'||previous>0?'重新打印':'首次打印';
        const remark=source === 'manual' ? `${key} | 人工补确认：操作员已核实实体工艺卡` : key; // Keep count and operator in dedicated fields.
        const cells=await Promise.all([
          // The SDK's createCell typing expects a full IOpenLink even though
          // its documented convenience input accepts only recordIds.
          // Keep the documented runtime format and adapt the compile-time type.
          linkField.createCell({recordIds:[id]} as Parameters<typeof linkField.createCell>[0]),
          logTime.createCell(stamp),
          logType.createCell(kind),
          logStatus.createCell('已打印'),
          logNote.createCell(remark),
          logOperator.createCell({id:operator}),
          logTarget.createCell(target)
        ]);
        const newId=await s.log.addRecord(cells);
        if(!newId)throw new Error('无法新增工艺卡打印记录');
        log={id:newId,unitId:id,label:'',time:stamp,kind,status:'已打印',note:remark,targetCount:target};
        existing.push(log);
      }
      if(!target)throw new Error('打印日志缺少同步目标次数；已停止写入，请人工核对后再试');
      // A retry must use the same immutable target, never the live linked lookup.
      const confirmedTarget=n(await logTarget.getValue(log.id));
      if(confirmedTarget !== target) {
        if (confirmedTarget === 0 && targetFromNote(log.note) === target) {
          // Migrate legacy in-flight retries without discarding the original job ID.
          checked(await logTarget.setValue(log.id,target),'同步目标次数');
        } else {
          throw new Error('同步目标次数不一致；停止写入，避免重复计数');
        }
      }
      // Even if the history entry was created on an earlier attempt, complete
      // and verify its operator field before changing downstream status.
      const currentOperator = await logOperator.getValue(log.id);
      if(!Array.isArray(currentOperator) || !currentOperator.some(u=>u.id===operator)) {
        checked(await logOperator.setValue(log.id, {id:operator} as Parameters<typeof logOperator.setValue>[1]), '打印人');
      }
      const verifiedOperator = await logOperator.getValue(log.id);
      if(!Array.isArray(verifiedOperator) || !verifiedOperator.some(u=>u.id===operator))
        throw new Error('打印人无法解析为飞书人员，已保留历史日志供重试；打印状态未继续更新');
      const latest=n(await countField.getValue(id));
      if(latest<target) checked(await countField.setValue(id,target),'打印次数');
      checked(await timeField.setValue(id,stamp),'打印时间');
      checked(await statusField.setValue(id,'已打印'),'打印状态');
      // Read-back checks are required before declaring a record synchronized.
      const [verified, verifiedCount, verifiedTime] = await Promise.all([
        statusField.getValue(id), countField.getValue(id), timeField.getValue(id)
      ]);
      if(verified?.text!=='已打印')throw new Error('打印状态写回校验未通过');
      if(n(verifiedCount)<target)throw new Error('打印次数写回校验未通过');
      if(Math.abs(n(verifiedTime)-stamp)>1000)throw new Error('打印时间写回校验未通过');
      result.success.push(id);
    }catch(e){result.failed.push({id,reason:e instanceof Error?e.message:String(e)});}
  }
  return result;
}
