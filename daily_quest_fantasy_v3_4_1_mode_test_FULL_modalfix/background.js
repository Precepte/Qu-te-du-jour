// V3.3 background: daily reminder at chosen hour + first-run flags
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

async function getSync(){ return await chrome.storage.sync.get(null); }

function nextOccurrenceAtHour(hour){
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate()+1);
  return next.getTime();
}

async function scheduleDailyReminder(){
  const s = await getSync();
  const hour = (typeof s.reminderHour === 'number') ? s.reminderHour : 9;
  // Clear existing
  const alarms = await chrome.alarms.getAll();
  for (const a of alarms){ if (a.name.startsWith('daily-reminder')) chrome.alarms.clear(a.name); }
  // Create new alarm at specific time, repeat daily
  chrome.alarms.create('daily-reminder@'+hour, { when: nextOccurrenceAtHour(hour), periodInMinutes: 24*60 });
}

chrome.runtime.onInstalled.addListener(async (details)=>{
  await chrome.storage.sync.set({ firstRunV33: true, hasSeenTutorial: false });
  await scheduleDailyReminder();
  console.log('Daily Quest – Fantasy V3.3 installed.');
});

chrome.runtime.onStartup.addListener(async ()=>{
  await scheduleDailyReminder();
});

chrome.storage.onChanged.addListener(async (changes, area)=>{
  if (area === 'sync' && changes.reminderHour) scheduleDailyReminder();
});

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse)=>{
  if (msg?.type === 'reschedule-alarms'){ scheduleDailyReminder(); }
  if (msg?.type === 'test-reminder'){
    chrome.notifications.create('dq-test', {
      type: 'basic',
      iconUrl: 'assets/icons/chest.png',
      title: 'Daily Quest — Test',
      message: 'Ceci est une notification de test.',
      priority: 1
    });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm)=>{
  if (!alarm.name.startsWith('daily-reminder')) return;
  const s = await getSync();
  if (s.lastPlayedDay === todayStr()) return; // already played today
  chrome.notifications.create('dq-daily', {
    type: 'basic',
    iconUrl: 'assets/icons/chest.png',
    title: 'Daily Quest',
    message: 'Revenez pour votre quête du jour !',
    priority: 1
  });
});