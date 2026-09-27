/* Local-only domain functions shared by the browser and Node tests. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'}).format(new Date());
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
  const shift = (s,n) => new Date(Date.parse(s)+n*DAY).toISOString().slice(0,10);
  const days = (a,b) => Math.round((Date.parse(b)-Date.parse(a))/DAY);
  const id = () => globalThis.crypto.randomUUID();
  const empty = () => ({version:1,students:[],attendance:[],payments:[],leads:[],drafts:[],settings:{name:'우리 태권도장',absenceDays:7}});
  const statuses = ['present','late','absent','excused'];
  const stages = ['문의','상담예정','체험예정','체험완료','등록완료','보류'];
  function validate(d) {
    const fail = () => {throw new Error('백업 형식 또는 데이터가 올바르지 않습니다. 기존 데이터는 유지됩니다.');};
    if (!d || d.version!==1 || !d.settings || typeof d.settings.name!=='string' || !d.settings.name.trim() || d.settings.name.length>100 || !Number.isInteger(d.settings.absenceDays) || d.settings.absenceDays<1 || d.settings.absenceDays>365) fail();
    const str=(x,n=5000)=>typeof x==='string'&&x.length<=n;
    const money=x=>Number.isSafeInteger(x)&&x>=0&&x<=100000000;
    for(const k of ['students','attendance','payments','leads','drafts']) {
      if(!Array.isArray(d[k])||d[k].length>100000) fail();
      const ids=new Set();
      for(const x of d[k]) {if(!x || !str(x.id,100)||!(/^[A-Za-z0-9_-]+$/).test(x.id)||ids.has(x.id)) fail();ids.add(x.id);}
    }
    const studentIds=new Set(d.students.map(s=>s.id));
    for(const s of d.students) if(!str(s.name,100)||!s.name.trim()||!str(s.group,100)||!money(s.fee)||!validDate(s.joined)||!['active','paused','left'].includes(s.status)||!str(s.memo)||!str(s.guardian,100)||!str(s.phone,40)||!Array.isArray(s.schedule)||!s.schedule.length||new Set(s.schedule).size!==s.schedule.length||s.schedule.some(n=>!Number.isInteger(n)||n<0||n>6)) fail();
    const keys=new Set();
    for(const a of d.attendance) {const k=a.studentId+'|'+a.date;if(!studentIds.has(a.studentId)||!validDate(a.date)||a.date<d.students.find(s=>s.id===a.studentId).joined||!statuses.includes(a.status)||keys.has(k)) fail();keys.add(k);}
    keys.clear();
    for(const p of d.payments) {const k=p.studentId+'|'+p.month;if(!studentIds.has(p.studentId)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month)||!money(p.due)||!money(p.paid)||p.paid>p.due||!str(p.note)||!(p.paidAt===''||validDate(p.paidAt))||keys.has(k)) fail();keys.add(k);}
    for(const l of d.leads) if(!str(l.name,100)||!l.name.trim()||!str(l.phone,40)||!str(l.note)||!stages.includes(l.stage)||!validDate(l.created)||!(l.next===''||validDate(l.next))) fail();
    for(const m of d.drafts) if(!studentIds.has(m.studentId)||!str(m.text,10000)||!str(m.kind,100)||!validDate(m.created)||m.status!=='draft') fail();
    return JSON.parse(JSON.stringify(d));
  }
  const eligible=(s,date)=>s.joined<=date && s.status==='active' && s.schedule.includes(new Date(date+'T00:00:00Z').getUTCDay());
  function mark(d,studentId,date,status) {
    const s=d.students.find(s=>s.id===studentId);
    if(!s || !validDate(date)||date>today()||date<s.joined||!statuses.includes(status)) throw new Error('등록일 이후부터 오늘까지의 출석만 기록할 수 있습니다.');
    const a=d.attendance.find(a=>a.studentId===studentId&&a.date===date);
    if(a) a.status=status;else d.attendance.push({id:id(),studentId,date,status});
  }
  function absences(d,date=today()) {
    return d.students.filter(s=>s.status==='active'&&s.joined<=date).map(s=>{
      const records=d.attendance.filter(a=>a.studentId===s.id&&a.date<=date).sort((a,b)=>b.date.localeCompare(a.date));
      const last=records.find(a=>['present','late','excused'].includes(a.status));
      const since=last?last.date:s.joined;
      const missed=records.filter(a=>a.date>=since&&a.status==='absent').length;
      return {...s,since,gap:days(since,date),missed};
    }).filter(s=>s.gap>=d.settings.absenceDays&&s.missed>0);
  }
  function period(kind,date) {
    if(!validDate(date)) throw new Error('날짜를 확인하세요.');
    if(kind==='week') {const n=(new Date(date+'T00:00:00Z').getUTCDay()+6)%7;const start=shift(date,-n);return [start,shift(start,6)];}
    if(kind==='month') {const start=date.slice(0,7)+'-01';const next=new Date(Date.UTC(+date.slice(0,4),+date.slice(5,7),1)).toISOString().slice(0,10);return [start,shift(next,-1)];}
    return [date,date];
  }
  function report(d,kind,date) {
    const [start,end]=period(kind,date);const rows=d.attendance.filter(a=>a.date>=start&&a.date<=end);
    const counts=Object.fromEntries(statuses.map(s=>[s,rows.filter(a=>a.status===s).length]));
    const checked=counts.present+counts.late+counts.absent;
    const payments=d.payments.filter(p=>p.month>=start.slice(0,7)&&p.month<=end.slice(0,7));
    return {start,end,counts,checked,rate:checked?Math.round((counts.present+counts.late)/checked*100):null,due:payments.reduce((n,p)=>n+p.due,0),paid:payments.reduce((n,p)=>n+p.paid,0),leads:d.leads.filter(l=>l.created>=start&&l.created<=end).length,registered:d.students.filter(s=>s.joined>=start&&s.joined<=end).length};
  }
  function command(d,raw,date=today()) {
    const q=raw.trim();let m;
    if(/(발송|전송|결제|삭제)/.test(q)) return {type:'answer',text:'실제 발송·결제·삭제는 지원하지 않습니다. 메시지는 초안으로만 작성합니다.'};
    if(q==='전체 출석 처리') return {type:'markAll',date};
    if((m=q.match(/^(.+?)\s+(출석|지각|결석|공결)\s*처리$/))) {
      const names=d.students.filter(s=>s.status==='active'&&s.name===m[1].trim());
      if(names.length!==1) return {type:'answer',text:names.length?'동명이인이 있습니다. 출석 화면에서 반을 확인하고 처리하세요.':'해당 이름의 재원 수련생을 찾지 못했습니다.'};
      return {type:'mark',studentId:names[0].id,date,status:{출석:'present',지각:'late',결석:'absent',공결:'excused'}[m[2]]};
    }
    if(/장기\s*결석/.test(q)) return {type:'navigate',page:'absence'};
    if(/미납|회비/.test(q)) return {type:'navigate',page:'fees'};
    if(/상담/.test(q)) return {type:'navigate',page:'crm',todayOnly:/오늘/.test(q)};
    if(/메시지|문자|초안/.test(q)) return {type:'navigate',page:'messages'};
    if(/백업|복원/.test(q)) return {type:'navigate',page:'settings'};
    if(/주간|이번\s*주/.test(q)) return {type:'report',kind:'week'};
    if(/월간|이번\s*달/.test(q)) return {type:'report',kind:'month'};
    if(/리포트|보고서/.test(q)) return {type:'report',kind:'day'};
    if(/결석자/.test(q)) return {type:'navigate',page:'attendance',filter:'absent'};
    if(/지각자/.test(q)) return {type:'navigate',page:'attendance',filter:'late'};
    if(/출석/.test(q)) return {type:'navigate',page:'attendance',filter:''};
    return {type:'answer',text:'지원 예시: 김민수 출석 처리 / 전체 출석 처리 / 장기결석 보여줘 / 회비 미납자 / 오늘 상담 예정 / 주간 리포트 / 메시지 초안 / 백업'};
  }
  const api={today,validDate,shift,days,id,empty,validate,statuses,stages,eligible,mark,absences,period,report,command};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;else root.Dojang=api;
})(globalThis);
