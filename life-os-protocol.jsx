import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LayoutDashboard, Workflow, Crosshair, Flame, Wallet, ListTodo,
  Github, ArrowDownToLine, ArrowUpToLine, Check, X, Plus, Trash2,
  ChevronLeft, ChevronRight, AlertTriangle, AlertCircle, CheckCircle2,
  TrendingUp, TrendingDown, Calendar, Clock, Building2, Star, Terminal,
  Zap, Edit3, GripVertical, Circle, ListChecks, BarChart3, ArrowRight,
  Loader2, Eye, EyeOff, FileJson, Hash, Sparkles, Search, HelpCircle,
  Command, Tag, Link as LinkIcon, MapPin, Briefcase, Trophy, Inbox,
  Upload, Download, RotateCcw, CornerDownLeft, Keyboard, Settings as Gear,
  Filter, ArrowUpDown, ChevronDown, ChevronUp, Activity as ActivityIcon
} from 'lucide-react';

/* ════════════════════════════════════════════════════════════════════════
   UTILITIES
   ════════════════════════════════════════════════════════════════════════ */

const uid = () => Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-4);
const cls = (...a) => a.filter(Boolean).join(' ');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pad = (n) => String(n).padStart(2, '0');
const APP_TIME_ZONE = 'Europe/Kyiv';

const todayLocalISO = (d = new Date()) => {
  // Use Kyiv calendar date explicitly. This avoids showing yesterday when the
  // device/browser timezone is UTC or another timezone while it is already
  // the next day in Ukraine.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const fmtNum = (n) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const fmtCurrency = (n, currency = 'UAH') => `${fmtNum(n)} ${currency}`;


/* ════════════════════════════════════════════════════════════════════════
   FINANCE LINE PARSER — interprets free-form notation
   Accepts:
     "-30 булочка"     → expense   30   "булочка"
     "+500 мама"       → income    500  "мама"
     "30грн-булочка"   → expense   30   "булочка"
     "+1100фріланс"    → income    1100 "фріланс"
     "Переказ:1000 айфон" → transfer 1000 "айфон"
     "Покупка: iPhone - 43000грн" → expense 43000 "Покупка: iPhone"
   Optional trailing (D.M) overrides date.
   Returns { type, amount, desc, date } or null if unparseable.
   ════════════════════════════════════════════════════════════════════════ */

function parseFinanceLine(rawLine, defaultDateISO) {
  if (!rawLine) return null;
  let line = rawLine.trim();
  if (!line) return null;

  // Skip headers/balance/summary lines
  if (line.startsWith('Баланс')) return null;
  if (/Витрати і доходи/.test(line)) return null;
  if (/^\d{1,2}\.\d{1,2}\s*\(.*Total/i.test(line)) return null;
  if (/^\d{1,2}\.\d{1,2}\s*\([+\-]?\d+\/[+\-]?\d+/.test(line)) return null;

  // Today as ISO date
  const today = (defaultDateISO || todayLocalISO()).slice(0, 10);
  let txDate = today;

  // Trailing (D.M)
  const dateM = line.match(/\((\d{1,2})\.(\d{1,2})\)\s*$/);
  if (dateM) {
    let day = parseInt(dateM[1]);
    let mon = parseInt(dateM[2]);
    // Clamp invalid days
    const maxDay = new Date(parseInt(today.slice(0, 4)), mon, 0).getDate();
    if (day > maxDay) day = maxDay;
    // Year inference: use current year, but if month far ahead, drop a year
    const refY = parseInt(today.slice(0, 4));
    const refM = parseInt(today.slice(5, 7));
    let year = refY;
    if (mon > refM + 6) year = refY - 1;
    txDate = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    line = line.slice(0, dateM.index).trim();
  }

  // Transfer
  const trM = line.match(/^Переказ\s*:?\s*(\d+(?:[.,]\d+)?)\s*(?:грн?)?\s*на?\s+(.+)$/i);
  if (trM) {
    return {
      type: 'transfer',
      amount: parseFloat(trM[1].replace(',', '.')),
      desc: trM[2].trim(),
      date: txDate,
    };
  }

  // Purchase (treated as a tagged expense)
  const puM = line.match(/^Покупка\s*:\s*(.+?)\s*-\s*(\d+(?:[.,]\d+)?)\s*грн?/i);
  if (puM) {
    return {
      type: 'expense',
      amount: parseFloat(puM[2].replace(',', '.')),
      desc: `Покупка: ${puM[1].trim()}`,
      date: txDate,
    };
  }

  // Sign at start
  let type = 'expense';
  if (line.startsWith('+')) { type = 'income'; line = line.slice(1).trim(); }
  else if (line.startsWith('-') || line.startsWith('−')) { line = line.slice(1).trim(); }

  // Amount + optional грн + optional separator + desc
  const am = line.match(/^(\d+(?:[.,]\d+)?)\s*\$?(?:\s*грн?)?\s*[-–—:]?\s*(.*)$/);
  if (!am) return null;
  const amount = parseFloat(am[1].replace(',', '.'));
  if (!amount || isNaN(amount)) return null;
  const desc = (am[2] || '').trim().replace(/^[-–—:\s]+/, '');

  return { type, amount, desc: desc || '?', date: txDate };
}



const getMonthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

const formatMonth = (key) => {
  if (!key) return '';
  const [y, m] = key.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const shiftMonth = (key, delta) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return getMonthKey(d);
};

const startOfWeek = (d = new Date()) => {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
};

const getWeekKey = (d = new Date()) => {
  const s = startOfWeek(d);
  return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
};

const getWeekDates = (d = new Date()) => {
  const s = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(s);
    day.setDate(s.getDate() + i);
    return day;
  });
};

const isSameDay = (a, b) =>
  a.getDate() === b.getDate() &&
  a.getMonth() === b.getMonth() &&
  a.getFullYear() === b.getFullYear();

const isToday = (d) => isSameDay(new Date(d), new Date());

const dateKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

const daysBetween = (a, b) => {
  const ms = new Date(b).setHours(0,0,0,0) - new Date(a).setHours(0,0,0,0);
  return Math.round(ms / 86400000);
};

const dayKeyFromDate = (d) => DAY_KEYS[d.getDay() === 0 ? 6 : d.getDay() - 1];

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const HABIT_EMOJI = ['🔥','📚','🏃','💪','🧘','💧','☕','🎯','✍️','🌅','🎨','🎵','💼','🥗','😴','📱','🚭','💰','🧠','♟'];

/* ════════════════════════════════════════════════════════════════════════
   INITIAL STATE — single JSON source of truth (v8)
   ════════════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════════════
   SEED FINANCE DATA — pre-parsed from user's existing log (Nov 2025 – Jul 2026)
   Loaded once on first run. After GitHub sync, this is overridden by remote.
   ════════════════════════════════════════════════════════════════════════ */

const SEED_FINANCE_NOTES = `Останній знімок балансу — 31.05.2026

КАРТКА І ГОТІВКА
  Карта:           6,500 грн
  Подушка:        14,000 грн
  Готівка USD:       $100

ВІДКЛАДЕННЯ        21,200 грн
  ├ 11,000  у банці
  └  5,900  готівкою

БОРГИ МЕНІ
  Мама винна:      7,000 грн

────────────────────────────
РАЗОМ UAH:        41,700 грн (без боргу)
   + борги:       48,700 грн
USD:                 $100

────────────────────────────
Заплановані великі витрати:
  • квитки на 14 червня (700 грн оплачено)
  • Світязь — ~4,000 грн

Цілі накопичень:
  • айфон ✅ (досягнуто, IPhone 15 Pro Max за 43,000)
  • наступна ціль: ?
`;

const SEED_FINANCE_MONTHS = JSON.parse(`{"2025-11":{"income":[{"id":"3636908963c","date":"2025-11-12T12:00:00.000Z","amount":425.0,"source":"мама"},{"id":"ea09c2229ef","date":"2025-11-12T12:00:00.000Z","amount":500.0,"source":"мама"},{"id":"89572015971","date":"2025-11-12T12:00:00.000Z","amount":200.0,"source":"мама"},{"id":"1f105816c77","date":"2025-11-12T12:00:00.000Z","amount":1100.0,"source":"фріланс"},{"id":"b892916c3dc","date":"2025-11-17T12:00:00.000Z","amount":700.0,"source":"фріланс"},{"id":"90a8952473d","date":"2025-11-20T12:00:00.000Z","amount":2850.0,"source":"(економія на скасуванні shopify, кошти перейшли у власне розпорядження)"},{"id":"df5678ef05e","date":"2025-11-20T12:00:00.000Z","amount":500.0,"source":"мама"},{"id":"7c51c90f166","date":"2025-11-20T12:00:00.000Z","amount":1600.0,"source":"фріланс(аванс)"},{"id":"d49702f8cbe","date":"2025-11-24T12:00:00.000Z","amount":2525.0,"source":"робота франц"},{"id":"e05354b57c0","date":"2025-11-24T12:00:00.000Z","amount":1600.0,"source":"фріланс"},{"id":"3e1980f016e","date":"2025-11-26T12:00:00.000Z","amount":1819.0,"source":"канадець"}],"expenses":[{"id":"11a06676c4f","date":"2025-11-01T12:00:00.000Z","amount":30.0,"desc":"булочка","category":""},{"id":"406df52303d","date":"2025-11-01T12:00:00.000Z","amount":34.0,"desc":"проїзд","category":""},{"id":"e18b2fd79bb","date":"2025-11-04T12:00:00.000Z","amount":400.0,"desc":"штраф за проїзд","category":""},{"id":"393d5b9b62a","date":"2025-11-04T12:00:00.000Z","amount":500.0,"desc":"спроба скласти іспит","category":""},{"id":"662b3b5aece","date":"2025-11-06T12:00:00.000Z","amount":35.0,"desc":"кола","category":""},{"id":"17c83c2c0fe","date":"2025-11-06T12:00:00.000Z","amount":150.0,"desc":"погуляти","category":""},{"id":"7170568d708","date":"2025-11-06T12:00:00.000Z","amount":51.0,"desc":"проїзд","category":""},{"id":"d5c7d08518f","date":"2025-11-07T12:00:00.000Z","amount":175.0,"desc":"реклама, фріланс","category":""},{"id":"9e71152de7a","date":"2025-11-08T12:00:00.000Z","amount":17.0,"desc":"проїзд","category":""},{"id":"3a881b5b49c","date":"2025-11-08T12:00:00.000Z","amount":126.0,"desc":"мобільний інтернет","category":""},{"id":"bbb8a8ce140","date":"2025-11-09T12:00:00.000Z","amount":50.0,"desc":"кола","category":""},{"id":"cebe74c135b","date":"2025-11-10T12:00:00.000Z","amount":450.0,"desc":"проїзд(абонемент на місяць)","category":""},{"id":"20aea50cfd7","date":"2025-11-12T12:00:00.000Z","amount":500.0,"desc":"реклама фейсбук","category":""},{"id":"302fb39d34a","date":"2025-11-12T12:00:00.000Z","amount":250.0,"desc":"жижа","category":""},{"id":"01753e77bbb","date":"2025-11-12T12:00:00.000Z","amount":40.0,"desc":"сік","category":""},{"id":"639f14ce82d","date":"2025-11-12T12:00:00.000Z","amount":431.0,"desc":"погуляти з дівчиною","category":""},{"id":"3e481699f44","date":"2025-11-17T12:00:00.000Z","amount":100.0,"desc":"на подарунок","category":""},{"id":"703e9f0bb1e","date":"2025-11-17T12:00:00.000Z","amount":200.0,"desc":"макд","category":""},{"id":"a50e436d66a","date":"2025-11-20T12:00:00.000Z","amount":27.0,"desc":"посилка","category":""},{"id":"5241faf4d40","date":"2025-11-20T12:00:00.000Z","amount":128.0,"desc":"сік+батончик","category":""},{"id":"5541b8e8b42","date":"2025-11-24T12:00:00.000Z","amount":100.0,"desc":"нагетси","category":""},{"id":"7183ae0e080","date":"2025-11-24T12:00:00.000Z","amount":736.0,"desc":"піца","category":""},{"id":"07f05abbdbf","date":"2025-11-26T12:00:00.000Z","amount":61.0,"desc":"обід","category":""},{"id":"8904d72c3d5","date":"2025-11-26T12:00:00.000Z","amount":60.0,"desc":"водичка","category":""},{"id":"a2f03a3e0d4","date":"2025-11-26T12:00:00.000Z","amount":200.0,"desc":"кава з дівчиною","category":""},{"id":"2db6960b41c","date":"2025-11-26T12:00:00.000Z","amount":115.0,"desc":"дезодорант","category":""},{"id":"61e69f3e8cf","date":"2025-11-26T12:00:00.000Z","amount":1800.0,"desc":"день народження подруги","category":""}],"transfers":[]},"2025-12":{"income":[{"id":"d2833e5ecc6","date":"2025-12-01T12:00:00.000Z","amount":1819.0,"source":"канадець"},{"id":"2974849ad56","date":"2025-12-01T12:00:00.000Z","amount":300.0,"source":"мама"},{"id":"3c9596d7ee4","date":"2025-12-01T12:00:00.000Z","amount":500.0,"source":"мама"},{"id":"af27e1d8820","date":"2025-12-04T12:00:00.000Z","amount":150.0,"source":"мама"},{"id":"4cd4f6f3b22","date":"2025-12-04T12:00:00.000Z","amount":1500.0,"source":"фріланс"},{"id":"81ccc4f61fa","date":"2025-12-04T12:00:00.000Z","amount":637.0,"source":"фріланс"},{"id":"6436d31f9e1","date":"2025-12-11T12:00:00.000Z","amount":2000.0,"source":"фріланс"},{"id":"c80d98d8150","date":"2025-12-11T12:00:00.000Z","amount":600.0,"source":"фріланс"},{"id":"750867a5d20","date":"2025-12-11T12:00:00.000Z","amount":500.0,"source":"мама"},{"id":"ae29a142db3","date":"2025-12-15T12:00:00.000Z","amount":1000.0,"source":"фріланс"},{"id":"e75114f444d","date":"2025-12-15T12:00:00.000Z","amount":300.0,"source":"мама"},{"id":"61d1a4eaeaa","date":"2025-12-20T12:00:00.000Z","amount":300.0,"source":"фріланс"},{"id":"fdb0df92b0e","date":"2025-12-20T12:00:00.000Z","amount":1500.0,"source":"фріланс"},{"id":"7b00757b0a7","date":"2025-12-23T12:00:00.000Z","amount":1787.0,"source":"колядки"},{"id":"c437de250a3","date":"2025-12-23T12:00:00.000Z","amount":2200.0,"source":"фріланс"},{"id":"31cf200d149","date":"2025-12-27T12:00:00.000Z","amount":500.0,"source":"мама"}],"expenses":[{"id":"b652c5ecea8","date":"2025-12-01T12:00:00.000Z","amount":1935.0,"desc":"подарунки","category":""},{"id":"8ecf10be9c4","date":"2025-12-01T12:00:00.000Z","amount":4780.0,"desc":"подарунки на миколая","category":""},{"id":"80f1bbfe346","date":"2025-12-01T12:00:00.000Z","amount":282.0,"desc":"презервативи","category":""},{"id":"fd36709e380","date":"2025-12-01T12:00:00.000Z","amount":487.0,"desc":"продукти","category":""},{"id":"ad70a93160a","date":"2025-12-01T12:00:00.000Z","amount":1960.0,"desc":"побачення","category":""},{"id":"2f121ba750a","date":"2025-12-04T12:00:00.000Z","amount":109.0,"desc":"пластилін","category":""},{"id":"9a22a5f877a","date":"2025-12-04T12:00:00.000Z","amount":175.0,"desc":"цукерки","category":""},{"id":"9e95edccafe","date":"2025-12-04T12:00:00.000Z","amount":39.0,"desc":"мандарини","category":""},{"id":"28c834ea109","date":"2025-12-04T12:00:00.000Z","amount":450.0,"desc":"абонемент на проїзд","category":""},{"id":"1825d5adec3","date":"2025-12-04T12:00:00.000Z","amount":500.0,"desc":"стоматолог","category":""},{"id":"0204d15956f","date":"2025-12-04T12:00:00.000Z","amount":450.0,"desc":"квитки на каток","category":""},{"id":"dd602c19dea","date":"2025-12-04T12:00:00.000Z","amount":455.0,"desc":"мак дональдс","category":""},{"id":"fff93afd215","date":"2025-12-04T12:00:00.000Z","amount":150.0,"desc":"піца","category":""},{"id":"7b0c04e7ca3","date":"2025-12-11T12:00:00.000Z","amount":412.0,"desc":"побачення","category":""},{"id":"463ca09da2e","date":"2025-12-15T12:00:00.000Z","amount":100.0,"desc":"сочок","category":""},{"id":"02af42bd0af","date":"2025-12-15T12:00:00.000Z","amount":40.0,"desc":"печиво","category":""},{"id":"2e44e125392","date":"2025-12-20T12:00:00.000Z","amount":110.0,"desc":"сиг","category":""},{"id":"f77c1149ffb","date":"2025-12-23T12:00:00.000Z","amount":106.0,"desc":"водичка","category":""},{"id":"38262e6fc97","date":"2025-12-23T12:00:00.000Z","amount":500.0,"desc":"Макса дн","category":""},{"id":"2e8645256e7","date":"2025-12-27T12:00:00.000Z","amount":410.0,"desc":"нр","category":""}],"transfers":[{"id":"fe5920908b4","date":"2025-12-23T12:00:00.000Z","amount":8040,"goal":"айфон"},{"id":"553524d3fcb","date":"2025-12-23T12:00:00.000Z","amount":2200,"goal":"айфон"},{"id":"48e48396eaa","date":"2025-12-27T12:00:00.000Z","amount":400,"goal":"айфон"}]},"2026-01":{"income":[{"id":"8662dc3c58f","date":"2026-01-01T12:00:00.000Z","amount":87.0,"source":"кешбек"},{"id":"d8ae5a0427e","date":"2026-01-01T12:00:00.000Z","amount":1030.0,"source":"фріланс"},{"id":"4e2d9fa395f","date":"2026-01-01T12:00:00.000Z","amount":9400.0,"source":"аванс 50% на січень від NOVA"},{"id":"135edb96332","date":"2026-01-09T12:00:00.000Z","amount":600.0,"source":"фріланс"},{"id":"030ba89d0e9","date":"2026-01-13T12:00:00.000Z","amount":1000.0,"source":"фріланс"},{"id":"70af737095d","date":"2026-01-19T12:00:00.000Z","amount":150.0,"source":"мама"},{"id":"24bf488f615","date":"2026-01-19T12:00:00.000Z","amount":50.0,"source":"Тарас повернув"},{"id":"90f45234946","date":"2026-01-19T12:00:00.000Z","amount":50.0,"source":"готівка"},{"id":"c9d4d756450","date":"2026-01-22T12:00:00.000Z","amount":159.0,"source":"повернення за ролл"},{"id":"d59d5682335","date":"2026-01-22T12:00:00.000Z","amount":500.0,"source":"мама"},{"id":"5983277871d","date":"2026-01-22T12:00:00.000Z","amount":600.0,"source":"фріланс"},{"id":"75c17ba1125","date":"2026-01-24T12:00:00.000Z","amount":330.0,"source":"мама"},{"id":"5919c51bfed","date":"2026-01-24T12:00:00.000Z","amount":9244.0,"source":"(50% за кінець Січня від NOVA)"}],"expenses":[{"id":"38ee242f89a","date":"2026-01-01T12:00:00.000Z","amount":210.0,"desc":"жижа","category":""},{"id":"f3d2e03a8aa","date":"2026-01-01T12:00:00.000Z","amount":440.0,"desc":"суші","category":""},{"id":"f669ce6c2a6","date":"2026-01-01T12:00:00.000Z","amount":420.0,"desc":"кебаб","category":""},{"id":"94508ea5f61","date":"2026-01-01T12:00:00.000Z","amount":450.0,"desc":"проїзд","category":""},{"id":"b403d35a36a","date":"2026-01-01T12:00:00.000Z","amount":116.0,"desc":"картридж","category":""},{"id":"4a3c9af8f3f","date":"2026-01-01T12:00:00.000Z","amount":120.0,"desc":"чіпси","category":""},{"id":"c924f2fd478","date":"2026-01-09T12:00:00.000Z","amount":151.0,"desc":"чіпси","category":""},{"id":"2bc6f248fe9","date":"2026-01-09T12:00:00.000Z","amount":1369.0,"desc":"квіти","category":""},{"id":"50ae275959c","date":"2026-01-09T12:00:00.000Z","amount":300.0,"desc":"квитки на каток","category":""},{"id":"279c3168fe8","date":"2026-01-09T12:00:00.000Z","amount":150.0,"desc":"жижа","category":""},{"id":"595b6979024","date":"2026-01-09T12:00:00.000Z","amount":82.0,"desc":"водичка","category":""},{"id":"28b2ef72bb5","date":"2026-01-13T12:00:00.000Z","amount":140.0,"desc":"різне","category":""},{"id":"1ebcec331c8","date":"2026-01-13T12:00:00.000Z","amount":450.0,"desc":"клуб","category":""},{"id":"340bf2d0d86","date":"2026-01-13T12:00:00.000Z","amount":470.0,"desc":"таксі","category":""},{"id":"9ec1791d323","date":"2026-01-19T12:00:00.000Z","amount":244.0,"desc":"таксі(бо трамвай не їхав)","category":""},{"id":"61d30cea328","date":"2026-01-19T12:00:00.000Z","amount":150.0,"desc":"кебаб","category":""},{"id":"bf514fe5bf5","date":"2026-01-19T12:00:00.000Z","amount":400.0,"desc":"лубрикант","category":""},{"id":"5682e10e5fe","date":"2026-01-19T12:00:00.000Z","amount":657.0,"desc":"мак","category":""},{"id":"19732a2eb94","date":"2026-01-22T12:00:00.000Z","amount":100.0,"desc":"попити","category":""},{"id":"cca8f4ba15f","date":"2026-01-22T12:00:00.000Z","amount":150.0,"desc":"жижа","category":""},{"id":"6c770d19eed","date":"2026-01-22T12:00:00.000Z","amount":80.0,"desc":"доставка","category":""},{"id":"18ac652de9b","date":"2026-01-22T12:00:00.000Z","amount":120.0,"desc":"кола і тест","category":""},{"id":"945be81d088","date":"2026-01-24T12:00:00.000Z","amount":112.0,"desc":"водичка","category":""},{"id":"77dfa5fd198","date":"2026-01-24T12:00:00.000Z","amount":360.0,"desc":"квитки в кіно","category":""},{"id":"e1087accb9e","date":"2026-01-24T12:00:00.000Z","amount":440.0,"desc":"ночівка","category":""},{"id":"acb17280fb5","date":"2026-01-24T12:00:00.000Z","amount":150.0,"desc":"жижа","category":""},{"id":"78b6065cd83","date":"2026-01-24T12:00:00.000Z","amount":320.0,"desc":"кебаб","category":""},{"id":"0ce6b6035df","date":"2026-01-24T12:00:00.000Z","amount":43000,"desc":"Покупка: IPhone 15 Pro Max","category":""},{"id":"4bfc95baa15","date":"2026-01-24T12:00:00.000Z","amount":60.0,"desc":"кола","category":""},{"id":"7f42d875bcd","date":"2026-01-24T12:00:00.000Z","amount":500.0,"desc":"Подарунок Лєрі","category":""}],"transfers":[{"id":"4c47023719b","date":"2026-01-01T12:00:00.000Z","amount":1000,"goal":"айфон"},{"id":"967aa578c6d","date":"2026-01-01T12:00:00.000Z","amount":6000,"goal":"айфон"},{"id":"f0243e41e86","date":"2026-01-13T12:00:00.000Z","amount":1000,"goal":"айфон"},{"id":"b66f5cac00e","date":"2026-01-24T12:00:00.000Z","amount":9000,"goal":"айфон"}]},"2026-02":{"income":[{"id":"de6069925d9","date":"2026-02-07T12:00:00.000Z","amount":13144.0,"source":"ЗП перші 2тижні лютого від NOVA"},{"id":"4b71d202651","date":"2026-02-15T12:00:00.000Z","amount":127.0,"source":"кешбек"},{"id":"ceb1b06757e","date":"2026-02-24T12:00:00.000Z","amount":13073.0,"source":"ЗП останні два тижні лютого від Nova"}],"expenses":[{"id":"aef6fbc2384","date":"2026-02-01T12:00:00.000Z","amount":73.0,"desc":"кава","category":""},{"id":"dc187a86b9c","date":"2026-02-01T12:00:00.000Z","amount":24.0,"desc":"водичка","category":""},{"id":"5b8d9b13f0f","date":"2026-02-01T12:00:00.000Z","amount":625.0,"desc":"спортзал(2.02 всього 1870 за три місяці лют,бер,квіт)","category":""},{"id":"18c0724876b","date":"2026-02-01T12:00:00.000Z","amount":250.0,"desc":"стрижка","category":""},{"id":"2d1f0731f08","date":"2026-02-01T12:00:00.000Z","amount":40.0,"desc":"водичка","category":""},{"id":"97ce9663e65","date":"2026-02-01T12:00:00.000Z","amount":350.0,"desc":"жижа","category":""},{"id":"58866ff337e","date":"2026-02-01T12:00:00.000Z","amount":190.0,"desc":"макдональлс","category":""},{"id":"d060f118b6c","date":"2026-02-07T12:00:00.000Z","amount":120.0,"desc":"водичка, кава","category":""},{"id":"021f445b33a","date":"2026-02-07T12:00:00.000Z","amount":450.0,"desc":"абонемент на проїзд","category":""},{"id":"da350d093a2","date":"2026-02-07T12:00:00.000Z","amount":100.0,"desc":"обід,кава","category":""},{"id":"dedaeb2a09c","date":"2026-02-07T12:00:00.000Z","amount":185.0,"desc":"інтернет","category":""},{"id":"5dda799470e","date":"2026-02-07T12:00:00.000Z","amount":183.0,"desc":"сніданок","category":""},{"id":"b0ba97e7b2b","date":"2026-02-07T12:00:00.000Z","amount":1500.0,"desc":"квіти","category":""},{"id":"764ceb70269","date":"2026-02-07T12:00:00.000Z","amount":1835.0,"desc":"іграшка","category":""},{"id":"5609e395778","date":"2026-02-07T12:00:00.000Z","amount":45.0,"desc":"водичка","category":""},{"id":"ddde7777a54","date":"2026-02-07T12:00:00.000Z","amount":62.0,"desc":"водичка","category":""},{"id":"4dab1079a1e","date":"2026-02-15T12:00:00.000Z","amount":50.0,"desc":"водичка","category":""},{"id":"c5b86914a19","date":"2026-02-15T12:00:00.000Z","amount":380.0,"desc":"мак","category":""},{"id":"faf8a6bebc7","date":"2026-02-15T12:00:00.000Z","amount":72.0,"desc":"хотдог","category":""},{"id":"38286259a4f","date":"2026-02-15T12:00:00.000Z","amount":1300.0,"desc":"карпати","category":""},{"id":"4406a2dc0ff","date":"2026-02-15T12:00:00.000Z","amount":300.0,"desc":"мобільний мамі Ірі","category":""},{"id":"d2b7508465e","date":"2026-02-15T12:00:00.000Z","amount":47.0,"desc":"булочка","category":""},{"id":"902303409aa","date":"2026-02-15T12:00:00.000Z","amount":147.0,"desc":"перекус в електричку","category":""},{"id":"e4d4f3ed622","date":"2026-02-15T12:00:00.000Z","amount":350.0,"desc":"підйомник","category":""},{"id":"e1b08906c74","date":"2026-02-15T12:00:00.000Z","amount":250.0,"desc":"таксі","category":""},{"id":"985505ec8e8","date":"2026-02-15T12:00:00.000Z","amount":48.0,"desc":"водичка","category":""},{"id":"9b63b1c5331","date":"2026-02-15T12:00:00.000Z","amount":116.0,"desc":"картридж","category":""},{"id":"4b30bb67000","date":"2026-02-15T12:00:00.000Z","amount":50.0,"desc":"поляна квасова","category":""},{"id":"bcdbf4d5227","date":"2026-02-15T12:00:00.000Z","amount":15.0,"desc":"водичка","category":""},{"id":"d68051a06ad","date":"2026-02-24T12:00:00.000Z","amount":1100.0,"desc":"мак","category":""},{"id":"04f5d23df2f","date":"2026-02-24T12:00:00.000Z","amount":175.0,"desc":"тортік","category":""},{"id":"dd6e97a9797","date":"2026-02-24T12:00:00.000Z","amount":44.0,"desc":"кава","category":""},{"id":"3f29d1d9550","date":"2026-02-24T12:00:00.000Z","amount":800.0,"desc":"піца","category":""},{"id":"1927872609a","date":"2026-02-24T12:00:00.000Z","amount":500.0,"desc":"туфлі Вікусі","category":""},{"id":"6ed68b05309","date":"2026-02-24T12:00:00.000Z","amount":2235.0,"desc":"одяг собі","category":""},{"id":"adb1838e797","date":"2026-02-24T12:00:00.000Z","amount":53.0,"desc":"кола","category":""}],"transfers":[]},"2026-03":{"income":[{"id":"85438fad837","date":"2026-03-01T12:00:00.000Z","amount":250.0,"source":"мама"},{"id":"c4e74b36884","date":"2026-03-09T12:00:00.000Z","amount":13378.0,"source":"зп перші два тижні березня від Nova"},{"id":"3d69569603f","date":"2026-03-27T12:00:00.000Z","amount":13177.0,"source":"зп другі два тижні березня від Nova"}],"expenses":[{"id":"6f4ce6319f3","date":"2026-03-01T12:00:00.000Z","amount":123.0,"desc":"перекус","category":""},{"id":"08362f3eff1","date":"2026-03-01T12:00:00.000Z","amount":46.0,"desc":"енергетик","category":""},{"id":"f6a6185dd87","date":"2026-03-01T12:00:00.000Z","amount":650.0,"desc":"тапочки Вікусі","category":""},{"id":"298d070db26","date":"2026-03-01T12:00:00.000Z","amount":80.0,"desc":"доставка","category":""},{"id":"077cad7b157","date":"2026-03-01T12:00:00.000Z","amount":1160.0,"desc":"солодке","category":""},{"id":"7481a3e0bb1","date":"2026-03-01T12:00:00.000Z","amount":150.0,"desc":"кебаб","category":""},{"id":"6a213d10f05","date":"2026-03-01T12:00:00.000Z","amount":80.0,"desc":"перекус","category":""},{"id":"cc34e219834","date":"2026-03-01T12:00:00.000Z","amount":1400.0,"desc":"заняття з інструктором","category":""},{"id":"d47d44d4567","date":"2026-03-01T12:00:00.000Z","amount":183.0,"desc":"сир косичка і гаражі","category":""},{"id":"6fbd7190025","date":"2026-03-01T12:00:00.000Z","amount":418.0,"desc":"мак мені і Вікусі","category":""},{"id":"a6b7eaa6790","date":"2026-03-01T12:00:00.000Z","amount":150.0,"desc":"жижа Вікусі","category":""},{"id":"9ce3e211a10","date":"2026-03-05T12:00:00.000Z","amount":42.0,"desc":"кава","category":""},{"id":"91c0f9c5b9d","date":"2026-03-05T12:00:00.000Z","amount":265.0,"desc":"жижа і картридж","category":""},{"id":"ad5bec2c973","date":"2026-03-05T12:00:00.000Z","amount":135.0,"desc":"водички","category":""},{"id":"1ce25734f8c","date":"2026-03-05T12:00:00.000Z","amount":300.0,"desc":"кебаб","category":""},{"id":"1caeb18d113","date":"2026-03-05T12:00:00.000Z","amount":500.0,"desc":"умивалка","category":""},{"id":"5030b0b8908","date":"2026-03-05T12:00:00.000Z","amount":400.0,"desc":"квіти бабі","category":""},{"id":"72177667070","date":"2026-03-05T12:00:00.000Z","amount":1820.0,"desc":"квіти Вікусі і її мамі","category":""},{"id":"7aee6ddd6c5","date":"2026-03-05T12:00:00.000Z","amount":280.0,"desc":"рево","category":""},{"id":"510b8e092be","date":"2026-03-05T12:00:00.000Z","amount":53.0,"desc":"водичка","category":""},{"id":"ea37fa3db3c","date":"2026-03-05T12:00:00.000Z","amount":43.0,"desc":"водичка","category":""},{"id":"ee76c2d1871","date":"2026-03-09T12:00:00.000Z","amount":82.0,"desc":"обід","category":""},{"id":"8644789503d","date":"2026-03-09T12:00:00.000Z","amount":140.0,"desc":"мобільний інтернет","category":""},{"id":"adc03ead457","date":"2026-03-09T12:00:00.000Z","amount":60.0,"desc":"водичка","category":""},{"id":"37eff4aaba5","date":"2026-03-09T12:00:00.000Z","amount":458.0,"desc":"абонемент на проїзд","category":""},{"id":"2f26f85c12e","date":"2026-03-09T12:00:00.000Z","amount":30.0,"desc":"водичка","category":""},{"id":"b63d8eb2937","date":"2026-03-09T12:00:00.000Z","amount":72.0,"desc":"сніданок","category":""},{"id":"049ebe3c329","date":"2026-03-09T12:00:00.000Z","amount":19.0,"desc":"водичка","category":""},{"id":"7eee081b229","date":"2026-03-09T12:00:00.000Z","amount":23.0,"desc":"водичка","category":""},{"id":"134a6f5b1df","date":"2026-03-09T12:00:00.000Z","amount":46.0,"desc":"водичка","category":""},{"id":"941d5fc3d3c","date":"2026-03-09T12:00:00.000Z","amount":394.0,"desc":"мак дональдс","category":""},{"id":"ba121598391","date":"2026-03-13T12:00:00.000Z","amount":88.0,"desc":"поїсти","category":""},{"id":"c87493689cc","date":"2026-03-13T12:00:00.000Z","amount":115.0,"desc":"дезік","category":""},{"id":"ee487cc2805","date":"2026-03-13T12:00:00.000Z","amount":190.0,"desc":"шампунь","category":""},{"id":"a754116c2da","date":"2026-03-13T12:00:00.000Z","amount":2000.0,"desc":"навушники","category":""},{"id":"5785db312f9","date":"2026-03-13T12:00:00.000Z","amount":85.0,"desc":"водичка","category":""},{"id":"6c03915653c","date":"2026-03-13T12:00:00.000Z","amount":160.0,"desc":"квитки кіно","category":""},{"id":"7a9fb039a30","date":"2026-03-13T12:00:00.000Z","amount":170.0,"desc":"попкорн","category":""},{"id":"1ce56911e3b","date":"2026-03-13T12:00:00.000Z","amount":300.0,"desc":"кебаб","category":""},{"id":"240b6848908","date":"2026-03-15T12:00:00.000Z","amount":80.0,"desc":"перекус","category":""},{"id":"81c42db6138","date":"2026-03-15T12:00:00.000Z","amount":350.0,"desc":"жижа","category":""},{"id":"3ca4407943f","date":"2026-03-15T12:00:00.000Z","amount":100.0,"desc":"обід","category":""},{"id":"adde8070a00","date":"2026-03-15T12:00:00.000Z","amount":90.0,"desc":"водичка","category":""},{"id":"74d2bf5a63b","date":"2026-03-15T12:00:00.000Z","amount":76.0,"desc":"пиво","category":""},{"id":"53860e66a7f","date":"2026-03-15T12:00:00.000Z","amount":190.0,"desc":"мак","category":""},{"id":"ef49b0b4109","date":"2026-03-15T12:00:00.000Z","amount":50.0,"desc":"водичка","category":""},{"id":"029ed35db33","date":"2026-03-15T12:00:00.000Z","amount":479.0,"desc":"іспит з водіння","category":""},{"id":"49b3a2ba0d1","date":"2026-03-20T12:00:00.000Z","amount":300.0,"desc":"стрижка","category":""},{"id":"1ebb8dc496a","date":"2026-03-20T12:00:00.000Z","amount":410.0,"desc":"прези","category":""},{"id":"c5896911a9d","date":"2026-03-20T12:00:00.000Z","amount":93.0,"desc":"водичка","category":""},{"id":"c343e371819","date":"2026-03-20T12:00:00.000Z","amount":187.0,"desc":"смаколики","category":""},{"id":"4658ead459c","date":"2026-03-20T12:00:00.000Z","amount":32.0,"desc":"хліб","category":""},{"id":"f1f3bc7d441","date":"2026-03-20T12:00:00.000Z","amount":52.0,"desc":"кола","category":""},{"id":"40877658875","date":"2026-03-20T12:00:00.000Z","amount":19.0,"desc":"пончик","category":""},{"id":"ad08d123486","date":"2026-03-20T12:00:00.000Z","amount":67.0,"desc":"обід","category":""},{"id":"6b73685c98f","date":"2026-03-20T12:00:00.000Z","amount":65.0,"desc":"пеновані","category":""},{"id":"cd661bb7482","date":"2026-03-20T12:00:00.000Z","amount":180.0,"desc":"кебаб","category":""},{"id":"369e21da453","date":"2026-03-20T12:00:00.000Z","amount":84.0,"desc":"водичка","category":""},{"id":"8713a02e394","date":"2026-03-20T12:00:00.000Z","amount":73.0,"desc":"сніданок","category":""},{"id":"08c304eb9cc","date":"2026-03-20T12:00:00.000Z","amount":5000.0,"desc":"одяг","category":""},{"id":"bc319f05333","date":"2026-03-20T12:00:00.000Z","amount":33.0,"desc":"водичка","category":""},{"id":"497801990fd","date":"2026-03-20T12:00:00.000Z","amount":136.0,"desc":"тісто","category":""},{"id":"34d4fc70f94","date":"2026-03-27T12:00:00.000Z","amount":48.0,"desc":"водичка","category":""},{"id":"2bc6a4ff025","date":"2026-03-27T12:00:00.000Z","amount":105.0,"desc":"каплі до носа","category":""},{"id":"caecf6effcd","date":"2026-03-27T12:00:00.000Z","amount":800.0,"desc":"ліс","category":""},{"id":"b43d5acf614","date":"2026-03-27T12:00:00.000Z","amount":380.0,"desc":"мак","category":""},{"id":"2ad2ecaa813","date":"2026-03-27T12:00:00.000Z","amount":60.0,"desc":"водичка","category":""},{"id":"f22e761bcb9","date":"2026-03-27T12:00:00.000Z","amount":20.0,"desc":"желейки","category":""},{"id":"bb328d19c46","date":"2026-03-27T12:00:00.000Z","amount":153.0,"desc":"інтернет","category":""}],"transfers":[]},"2026-04":{"income":[{"id":"58bda39be40","date":"2026-04-04T12:00:00.000Z","amount":1500.0,"source":"день народження"},{"id":"418acaad136","date":"2026-04-09T12:00:00.000Z","amount":100.0,"source":"(4000грн)(готівка-відкладення)день народження"},{"id":"a1d2125ded6","date":"2026-04-09T12:00:00.000Z","amount":1200.0,"source":"фріланс"},{"id":"11b66b99150","date":"2026-04-09T12:00:00.000Z","amount":13118.0,"source":"зп перші два тижні квітня від Nova"},{"id":"9eafd6d4f92","date":"2026-04-09T12:00:00.000Z","amount":1000.0,"source":"дід олег день народження"},{"id":"56b7fa35846","date":"2026-04-09T12:00:00.000Z","amount":2000.0,"source":"чернівці день народження"},{"id":"6ad55e9fda5","date":"2026-04-14T12:00:00.000Z","amount":2000.0,"source":"день народження"},{"id":"7da8e4903e1","date":"2026-04-19T12:00:00.000Z","amount":13365.0,"source":"зп два останні тижні квітня від Nova"}],"expenses":[{"id":"25763ef8f27","date":"2026-04-01T12:00:00.000Z","amount":100.0,"desc":"інтернет","category":""},{"id":"dc1f6c921a3","date":"2026-04-01T12:00:00.000Z","amount":45.0,"desc":"вода","category":""},{"id":"ba65db92efa","date":"2026-04-01T12:00:00.000Z","amount":35.0,"desc":"чай","category":""},{"id":"e40dfe00290","date":"2026-04-01T12:00:00.000Z","amount":175.0,"desc":"bubbletea","category":""},{"id":"78eaf91d085","date":"2026-04-01T12:00:00.000Z","amount":134.0,"desc":"перекус","category":""},{"id":"0ca55ed19e8","date":"2026-04-01T12:00:00.000Z","amount":262.0,"desc":"пікнік","category":""},{"id":"a60e621afb5","date":"2026-04-01T12:00:00.000Z","amount":60.0,"desc":"трамвай","category":""},{"id":"709ddd92a4d","date":"2026-04-04T12:00:00.000Z","amount":19.0,"desc":"водичка","category":""},{"id":"5006528728d","date":"2026-04-04T12:00:00.000Z","amount":1875.0,"desc":"програма англійської","category":""},{"id":"54b6297d4eb","date":"2026-04-04T12:00:00.000Z","amount":50.0,"desc":"йогурт","category":""},{"id":"354855dc7bf","date":"2026-04-04T12:00:00.000Z","amount":200.0,"desc":"мобільний інтернет","category":""},{"id":"c2167d23e6d","date":"2026-04-04T12:00:00.000Z","amount":35.0,"desc":"чай","category":""},{"id":"e663361f3d0","date":"2026-04-04T12:00:00.000Z","amount":48.0,"desc":"сніданок","category":""},{"id":"c916ff64a6c","date":"2026-04-04T12:00:00.000Z","amount":30.0,"desc":"вода","category":""},{"id":"0c2546ec987","date":"2026-04-04T12:00:00.000Z","amount":130.0,"desc":"солодощі","category":""},{"id":"0385853fe5e","date":"2026-04-09T12:00:00.000Z","amount":265.0,"desc":"жижа","category":""},{"id":"351214255e2","date":"2026-04-09T12:00:00.000Z","amount":185.0,"desc":"шампунь","category":""},{"id":"52cd2818cdd","date":"2026-04-09T12:00:00.000Z","amount":20.0,"desc":"дорога","category":""},{"id":"b3dca3030b9","date":"2026-04-14T12:00:00.000Z","amount":450.0,"desc":"абонемент на проїзд","category":""},{"id":"3d5a69d68c2","date":"2026-04-14T12:00:00.000Z","amount":144.0,"desc":"солодке","category":""},{"id":"8ee85bd7d91","date":"2026-04-14T12:00:00.000Z","amount":838.0,"desc":"шашлик","category":""},{"id":"4c22d0ca7f4","date":"2026-04-14T12:00:00.000Z","amount":1440.0,"desc":"майстерклас гончарства","category":""},{"id":"a2ff4a0dd13","date":"2026-04-14T12:00:00.000Z","amount":15.0,"desc":"водичка","category":""},{"id":"2fabbe78c55","date":"2026-04-14T12:00:00.000Z","amount":158.0,"desc":"перекус на двох","category":""},{"id":"30b602bfa05","date":"2026-04-14T12:00:00.000Z","amount":1530.0,"desc":"квіти","category":""},{"id":"56c8b7cab47","date":"2026-04-14T12:00:00.000Z","amount":5000.0,"desc":"день народження","category":""},{"id":"7825e0a7059","date":"2026-04-14T12:00:00.000Z","amount":115.0,"desc":"таксі","category":""},{"id":"75fcce46958","date":"2026-04-14T12:00:00.000Z","amount":980.0,"desc":"ресторан","category":""},{"id":"160606dd8fb","date":"2026-04-19T12:00:00.000Z","amount":70.0,"desc":"чебурек","category":""},{"id":"9d31364b595","date":"2026-04-19T12:00:00.000Z","amount":240.0,"desc":"лабки","category":""},{"id":"2d8a00ec129","date":"2026-04-19T12:00:00.000Z","amount":172.0,"desc":"піца","category":""},{"id":"83df1ae8af6","date":"2026-04-19T12:00:00.000Z","amount":477.0,"desc":"чай","category":""},{"id":"ea32a87e39d","date":"2026-04-19T12:00:00.000Z","amount":40.0,"desc":"водичка","category":""},{"id":"e74973bccc3","date":"2026-04-19T12:00:00.000Z","amount":170.0,"desc":"урок фортепіано","category":""},{"id":"f71a4dbfd09","date":"2026-04-19T12:00:00.000Z","amount":180.0,"desc":"кебаб Вікусі","category":""},{"id":"7a0bf4acb5b","date":"2026-04-19T12:00:00.000Z","amount":185.0,"desc":"кебаб","category":""},{"id":"c89c5fccafe","date":"2026-04-19T12:00:00.000Z","amount":150.0,"desc":"снеки","category":""},{"id":"f9ac65821ce","date":"2026-04-19T12:00:00.000Z","amount":191.0,"desc":"смазка","category":""},{"id":"b69f6cd1ec3","date":"2026-04-19T12:00:00.000Z","amount":112.0,"desc":"водичка і кіндер","category":""},{"id":"d026b4df7ae","date":"2026-04-19T12:00:00.000Z","amount":110.0,"desc":"морозиво","category":""},{"id":"131f08d2a64","date":"2026-04-19T12:00:00.000Z","amount":80.0,"desc":"водичка","category":""},{"id":"8a90e9bac39","date":"2026-04-19T12:00:00.000Z","amount":80.0,"desc":"пиріжки","category":""},{"id":"49f11af5cfc","date":"2026-04-19T12:00:00.000Z","amount":225.0,"desc":"обід","category":""},{"id":"dd191d6d83a","date":"2026-04-19T12:00:00.000Z","amount":100.0,"desc":"сніданок","category":""},{"id":"1eab28086e8","date":"2026-04-19T12:00:00.000Z","amount":242.0,"desc":"бп","category":""}],"transfers":[]},"2026-05":{"income":[{"id":"dbe88d6424e","date":"2026-05-06T12:00:00.000Z","amount":77.0,"source":"кешбек"},{"id":"3552a2ddc5e","date":"2026-05-06T12:00:00.000Z","amount":15771.0,"source":"зп за перші два тижні травня від Nova"},{"id":"821846dd763","date":"2026-05-06T12:00:00.000Z","amount":100.0,"source":"мама"},{"id":"a2117a577cd","date":"2026-05-14T12:00:00.000Z","amount":86.0,"source":"кешбек"},{"id":"cb372bd7991","date":"2026-05-14T12:00:00.000Z","amount":15666.0,"source":"зп за другу половину травня від Nova"}],"expenses":[{"id":"fd1f4272926","date":"2026-05-01T12:00:00.000Z","amount":85.0,"desc":"водичка","category":""},{"id":"cd3149ff89a","date":"2026-05-01T12:00:00.000Z","amount":573.0,"desc":"львівські круасани","category":""},{"id":"5e2a9b06335","date":"2026-05-01T12:00:00.000Z","amount":25.0,"desc":"водичка","category":""},{"id":"18ae7587335","date":"2026-05-01T12:00:00.000Z","amount":223.0,"desc":"таксі","category":""},{"id":"738aea936aa","date":"2026-05-01T12:00:00.000Z","amount":12184.0,"desc":"права","category":""},{"id":"a8fcb59786b","date":"2026-05-01T12:00:00.000Z","amount":85.0,"desc":"водичка","category":""},{"id":"3f596c87caa","date":"2026-05-01T12:00:00.000Z","amount":200.0,"desc":"мак","category":""},{"id":"37a0a1d1334","date":"2026-05-01T12:00:00.000Z","amount":84.0,"desc":"рябчики","category":""},{"id":"2b34a0804e6","date":"2026-05-01T12:00:00.000Z","amount":64.0,"desc":"вода","category":""},{"id":"b85a3608a55","date":"2026-05-01T12:00:00.000Z","amount":205.0,"desc":"мобільний рахунок","category":""},{"id":"5baac705f71","date":"2026-05-01T12:00:00.000Z","amount":250.0,"desc":"урок фно","category":""},{"id":"0252a1e252d","date":"2026-05-01T12:00:00.000Z","amount":40.0,"desc":"водичка","category":""},{"id":"89a7a4c4ab7","date":"2026-05-01T12:00:00.000Z","amount":338.0,"desc":"піца","category":""},{"id":"205e722ec78","date":"2026-05-01T12:00:00.000Z","amount":90.0,"desc":"перекус","category":""},{"id":"65f862e22a8","date":"2026-05-01T12:00:00.000Z","amount":500.0,"desc":"парк культур","category":""},{"id":"810afcb6cd6","date":"2026-05-01T12:00:00.000Z","amount":66.0,"desc":"водичка","category":""},{"id":"4a3965ab24d","date":"2026-05-01T12:00:00.000Z","amount":72.0,"desc":"морозиво","category":""},{"id":"a6494a7cd55","date":"2026-05-01T12:00:00.000Z","amount":185.0,"desc":"домашній інтернет","category":""},{"id":"5313557ef52","date":"2026-05-01T12:00:00.000Z","amount":100.0,"desc":"перекус","category":""},{"id":"af317a6c362","date":"2026-05-01T12:00:00.000Z","amount":167.0,"desc":"випічка і водичка для двох","category":""},{"id":"5d113fef1c1","date":"2026-05-01T12:00:00.000Z","amount":45.0,"desc":"вода додому","category":""},{"id":"5eb707322fa","date":"2026-05-01T12:00:00.000Z","amount":15.0,"desc":"чай","category":""},{"id":"c5f70134891","date":"2026-05-01T12:00:00.000Z","amount":150.0,"desc":"чипси, морозиво","category":""},{"id":"be7578c68b5","date":"2026-05-06T12:00:00.000Z","amount":600.0,"desc":"мамі подарунок","category":""},{"id":"93b72feba06","date":"2026-05-06T12:00:00.000Z","amount":46.0,"desc":"водичка","category":""},{"id":"64fdde46d88","date":"2026-05-06T12:00:00.000Z","amount":72.0,"desc":"комісія за зняття готівки","category":""},{"id":"6853b714a35","date":"2026-05-06T12:00:00.000Z","amount":368.0,"desc":"львівські круасани","category":""},{"id":"933fefbe68b","date":"2026-05-06T12:00:00.000Z","amount":40.0,"desc":"водичка","category":""},{"id":"d37035d576e","date":"2026-05-06T12:00:00.000Z","amount":35.0,"desc":"друк","category":""},{"id":"8af5e2e559f","date":"2026-05-06T12:00:00.000Z","amount":100.0,"desc":"лаваш з сосисками","category":""},{"id":"6363a1db576","date":"2026-05-06T12:00:00.000Z","amount":242.0,"desc":"бп","category":""},{"id":"2a9bba631dd","date":"2026-05-06T12:00:00.000Z","amount":187.0,"desc":"шампунь","category":""},{"id":"c4f8fb1e1a5","date":"2026-05-06T12:00:00.000Z","amount":250.0,"desc":"урок фно","category":""},{"id":"484903564ac","date":"2026-05-06T12:00:00.000Z","amount":133.0,"desc":"водичка+перекус","category":""},{"id":"ee2479f60ec","date":"2026-05-06T12:00:00.000Z","amount":1000.0,"desc":"чайник","category":""},{"id":"042d97fbbaf","date":"2026-05-06T12:00:00.000Z","amount":400.0,"desc":"піца","category":""},{"id":"879922acb26","date":"2026-05-06T12:00:00.000Z","amount":50.0,"desc":"водичка","category":""},{"id":"50c6455b70b","date":"2026-05-06T12:00:00.000Z","amount":1980.0,"desc":"зал","category":""},{"id":"fa5c3377656","date":"2026-05-06T12:00:00.000Z","amount":350.0,"desc":"жижа","category":""},{"id":"ecbff020ddd","date":"2026-05-06T12:00:00.000Z","amount":320.0,"desc":"кебаб","category":""},{"id":"52f650ad179","date":"2026-05-06T12:00:00.000Z","amount":471.0,"desc":"антипреспірант","category":""},{"id":"4e0d96a8a42","date":"2026-05-06T12:00:00.000Z","amount":90.0,"desc":"перекус","category":""},{"id":"694b6f680f5","date":"2026-05-06T12:00:00.000Z","amount":34.0,"desc":"водичка","category":""},{"id":"eb0f50a1d84","date":"2026-05-06T12:00:00.000Z","amount":38.0,"desc":"кола","category":""},{"id":"ffa84d5bf2c","date":"2026-05-06T12:00:00.000Z","amount":368.0,"desc":"піца","category":""},{"id":"22400f0200e","date":"2026-05-06T12:00:00.000Z","amount":150.0,"desc":"кебаб","category":""},{"id":"bdd48e13fed","date":"2026-05-14T12:00:00.000Z","amount":19.0,"desc":"картридж","category":""},{"id":"bcd98fc04ae","date":"2026-05-14T12:00:00.000Z","amount":467.0,"desc":"абонемент на проїзд","category":""},{"id":"420d2d0fbfa","date":"2026-05-14T12:00:00.000Z","amount":700.0,"desc":"квитки на 14червня","category":""},{"id":"86d027c4623","date":"2026-05-14T12:00:00.000Z","amount":400.0,"desc":"ремонт зарядки","category":""},{"id":"031873dd681","date":"2026-05-14T12:00:00.000Z","amount":280.0,"desc":"рево","category":""},{"id":"4e284086070","date":"2026-05-14T12:00:00.000Z","amount":250.0,"desc":"урок фно","category":""},{"id":"752cd42da18","date":"2026-05-14T12:00:00.000Z","amount":275.0,"desc":"мак","category":""},{"id":"208b1e50f50","date":"2026-05-14T12:00:00.000Z","amount":89.0,"desc":"перекуси","category":""},{"id":"39bfe2bf99a","date":"2026-05-14T12:00:00.000Z","amount":21.0,"desc":"близенько","category":""},{"id":"7af7b0edd16","date":"2026-05-14T12:00:00.000Z","amount":40.0,"desc":"беляш","category":""},{"id":"a6e01d8b3f9","date":"2026-05-14T12:00:00.000Z","amount":205.0,"desc":"рукавичка","category":""},{"id":"33774ccfd4d","date":"2026-05-14T12:00:00.000Z","amount":45.0,"desc":"вода","category":""},{"id":"2ca98d87bfb","date":"2026-05-14T12:00:00.000Z","amount":19.0,"desc":"близенько","category":""},{"id":"1f099785f23","date":"2026-05-14T12:00:00.000Z","amount":100.0,"desc":"лаваш","category":""},{"id":"67b0c1900a3","date":"2026-05-14T12:00:00.000Z","amount":45.0,"desc":"самокат","category":""},{"id":"798e7722d13","date":"2026-05-14T12:00:00.000Z","amount":20.0,"desc":"близенько","category":""},{"id":"03499d26ab4","date":"2026-05-14T12:00:00.000Z","amount":150.0,"desc":"близенько","category":""},{"id":"877c61ad9b5","date":"2026-05-14T12:00:00.000Z","amount":36.0,"desc":"водичка","category":""},{"id":"be76880fab0","date":"2026-05-14T12:00:00.000Z","amount":48.0,"desc":"самокат","category":""},{"id":"c36cd18ecd9","date":"2026-05-14T12:00:00.000Z","amount":22.0,"desc":"близенько","category":""},{"id":"626d3b4629a","date":"2026-05-14T12:00:00.000Z","amount":111.0,"desc":"піца","category":""},{"id":"24281556985","date":"2026-05-14T12:00:00.000Z","amount":67.0,"desc":"перекус","category":""},{"id":"4beae0418be","date":"2026-05-14T12:00:00.000Z","amount":340.0,"desc":"жижа","category":""},{"id":"552101adb74","date":"2026-05-14T12:00:00.000Z","amount":250.0,"desc":"урок фно","category":""},{"id":"b63d1be151d","date":"2026-05-14T12:00:00.000Z","amount":32.0,"desc":"водичка","category":""},{"id":"a8d1df98d53","date":"2026-05-14T12:00:00.000Z","amount":330.0,"desc":"кебаб","category":""},{"id":"ac81b2abde0","date":"2026-05-14T12:00:00.000Z","amount":93.0,"desc":"перекус","category":""},{"id":"59a0b5e1b7d","date":"2026-05-14T12:00:00.000Z","amount":101.0,"desc":"перекус","category":""},{"id":"648122fe310","date":"2026-05-14T12:00:00.000Z","amount":40.0,"desc":"беляш","category":""},{"id":"bc5552f335d","date":"2026-05-14T12:00:00.000Z","amount":300.0,"desc":"не пам","category":""},{"id":"7bce12fa419","date":"2026-05-14T12:00:00.000Z","amount":30.0,"desc":"водичка","category":""},{"id":"cf42c01af93","date":"2026-05-14T12:00:00.000Z","amount":72.0,"desc":"перекус","category":""},{"id":"aef0c57c709","date":"2026-05-14T12:00:00.000Z","amount":40.0,"desc":"беляш","category":""},{"id":"bcdff7ea945","date":"2026-05-14T12:00:00.000Z","amount":180.0,"desc":"кава","category":""},{"id":"0f215260860","date":"2026-05-14T12:00:00.000Z","amount":360.0,"desc":"піца","category":""},{"id":"090c08473c8","date":"2026-05-14T12:00:00.000Z","amount":2040.0,"desc":"квіти","category":""},{"id":"9a677cbacb3","date":"2026-05-14T12:00:00.000Z","amount":150.0,"desc":"не пам","category":""},{"id":"65c5693e9f5","date":"2026-05-14T12:00:00.000Z","amount":323.0,"desc":"львівські круасани","category":""},{"id":"5b5ae2e3b04","date":"2026-05-14T12:00:00.000Z","amount":61.0,"desc":"водичка","category":""},{"id":"5ea6f30062c","date":"2026-05-14T12:00:00.000Z","amount":319.0,"desc":"таксі","category":""},{"id":"4eedc1186ab","date":"2026-05-14T12:00:00.000Z","amount":600.0,"desc":"мак","category":""},{"id":"d1a630041b5","date":"2026-05-14T12:00:00.000Z","amount":200.0,"desc":"мобільний інтернет","category":""},{"id":"f66d7956fe7","date":"2026-05-14T12:00:00.000Z","amount":250.0,"desc":"урок фно","category":""},{"id":"d802f13f97c","date":"2026-05-14T12:00:00.000Z","amount":172.0,"desc":"чипси","category":""}],"transfers":[]},"2026-06":{"income":[],"expenses":[{"id":"a5066f42e0e","date":"2026-06-01T12:00:00.000Z","amount":68.0,"desc":"перекус","category":""},{"id":"b767b3710e8","date":"2026-06-01T12:00:00.000Z","amount":69.0,"desc":"перекус","category":""},{"id":"6dd7aefd9f4","date":"2026-06-01T12:00:00.000Z","amount":104.0,"desc":"перекус","category":""},{"id":"7d74fbc3ebb","date":"2026-06-01T12:00:00.000Z","amount":71.0,"desc":"бутильована вода додому","category":""}],"transfers":[]},"2026-07":{"income":[],"expenses":[{"id":"b6f533bce42","date":"2026-07-01T12:00:00.000Z","amount":4000.0,"desc":"Світязь","category":""}],"transfers":[]}}`);

const initialData = {
  version: 8,
  nova: {
    categories: [
      { id: 'leadgen', name: 'Lead Gen', color: 'emerald' },
      { id: 'analytics', name: 'Analytics', color: 'cyan' },
      { id: 'calls', name: 'Calls', color: 'amber' },
    ],
    tasks: [], // {id,title,notes,categoryId,priority,completed,createdAt,completedAt?,dueDate?,tags?[]}
  },
  jobs: {
    columns: [
      { id: 'target', name: 'Target List' },
      { id: 'contacted', name: 'Contacted' },
      { id: 'interviewing', name: 'Interviewing' },
      { id: 'offer', name: 'Offer' },
    ],
    cards: [], // {id,columnId,company,role,notes,salary?,url?,location?,appliedAt?,nextFollowUp?,createdAt}
  },
  habits: {
    list: [
      { id: 'english', name: 'English', emoji: '📚', target: 7 },
      { id: 'running', name: 'Running', emoji: '🏃', target: 4 },
      { id: 'reading', name: 'Reading', emoji: '📖', target: 7 },
      { id: 'gym', name: 'Gym', emoji: '💪', target: 3 },
      { id: 'calorie', name: 'Calorie Track', emoji: '🥗', target: 7 },
    ],
    weeks: {}, // { [weekKey]: { [habitId]: { mon, tue, ... } } }
  },
  finance: {
    months: SEED_FINANCE_MONTHS, // { [monthKey]: { income: [], expenses: [], transfers: [] } }
    limit: 12000,
    currency: 'UAH',
    expenseCategories: [
      'Food', 'Transport', 'Bills', 'Entertainment',
      'Shopping', 'Health', 'Education', 'Other',
    ],
    budgets: {}, // { [category]: monthly budget number }
    notes: SEED_FINANCE_NOTES, // freeform notes: balance snapshots, debts, savings, etc
  },
  generalTasks: [], // {id,title,completed,priority,createdAt,completedAt?}
  activity: [], // {id,type,text,ts} — capped at 100
  settings: {
    githubToken: '',
    githubRepo: '',
    lastSync: null,
  },
};

/* ════════════════════════════════════════════════════════════════════════
   LOCAL + REMOTE DATA HYDRATION
   Fix: app must not always start from hardcoded initialData.
   It loads the last saved state from localStorage, preserves GitHub settings,
   and normalizes older remote JSON shapes before applying them to React state.
   ════════════════════════════════════════════════════════════════════════ */

const STORAGE_KEY = 'life-os:data:v8';
const DATA_FILE = 'data.json';

function getPublicDataUrl() {
  if (typeof window === 'undefined') return DATA_FILE;

  // Same logic as the working HTML example: the public app reads the data file
  // from the deployed site itself, so incognito/phone get the latest committed data too.
  const cleanHref = window.location.href.split('#')[0].split('?')[0];
  const url = new URL(DATA_FILE, cleanHref.endsWith('/') ? cleanHref : cleanHref.replace(/[^/]*$/, ''));
  url.searchParams.set('t', String(Date.now()));
  return url.toString();
}

async function loadPublicData() {
  if (typeof window === 'undefined') return null;

  try {
    const res = await fetch(getPublicDataUrl(), {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('Failed to load public data.json:', e);
    return null;
  }
}

function getDataStamp(appData) {
  return appData?.settings?.lastSync || appData?.lastUpdated || appData?.updatedAt || '';
}

function shouldUseRemoteData(remote, local) {
  if (!remote) return false;
  if (!local) return true;

  const remoteStamp = getDataStamp(remote);
  const localStamp = getDataStamp(local);

  // If timestamps exist, use the newer version.
  if (remoteStamp || localStamp) return remoteStamp >= localStamp;

  // First-run fallback: remote beats hardcoded seed.
  return true;
}

function stripGithubToken(appData) {
  const { githubToken, ...safeSettings } = appData.settings || {};
  return {
    ...appData,
    settings: safeSettings,
  };
}

function normalizeAppData(incoming = {}, currentSettings = {}) {
  const merged = {
    ...initialData,
    ...incoming,
    nova: {
      ...initialData.nova,
      ...(incoming.nova || {}),
      categories: incoming.nova?.categories || initialData.nova.categories,
      tasks: incoming.nova?.tasks || [],
    },
    jobs: {
      ...initialData.jobs,
      ...(incoming.jobs || {}),
      columns: incoming.jobs?.columns || initialData.jobs.columns,
      cards: incoming.jobs?.cards || [],
    },
    habits: {
      ...initialData.habits,
      ...(incoming.habits || {}),
      list: incoming.habits?.list || initialData.habits.list,
      weeks: incoming.habits?.weeks || {},
    },
    finance: {
      ...initialData.finance,
      ...(incoming.finance || {}),
      months: incoming.finance?.months || initialData.finance.months,
      expenseCategories: incoming.finance?.expenseCategories || initialData.finance.expenseCategories,
      budgets: incoming.finance?.budgets || {},
      notes: incoming.finance?.notes ?? initialData.finance.notes,
    },
    generalTasks: incoming.generalTasks || [],
    activity: incoming.activity || [],
    settings: {
      ...initialData.settings,
      ...(incoming.settings || {}),
      ...currentSettings,
    },
  };

  // Normalize old month objects where transfers did not exist yet.
  const months = { ...(merged.finance.months || {}) };
  Object.keys(months).forEach((key) => {
    const m = months[key] || {};
    months[key] = {
      income: m.income || [],
      expenses: m.expenses || [],
      transfers: m.transfers || [],
    };
  });
  merged.finance.months = months;

  return merged;
}

function loadLocalData() {
  if (typeof window === 'undefined') return initialData;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialData;
    return normalizeAppData(JSON.parse(raw));
  } catch (e) {
    console.warn('Failed to load local data:', e);
    return initialData;
  }
}

function saveLocalData(appData) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  } catch (e) {
    console.warn('Failed to save local data:', e);
  }
}

/* ════════════════════════════════════════════════════════════════════════
   ACTIVITY LOG — append-only, capped
   ════════════════════════════════════════════════════════════════════════ */

const logActivity = (setData, type, text) => {
  setData((prev) => ({
    ...prev,
    activity: [
      { id: uid(), type, text, ts: new Date().toISOString() },
      ...((prev.activity || [])),
    ].slice(0, 100),
  }));
};

/* ════════════════════════════════════════════════════════════════════════
   GITHUB SYNC — base64 + REST API (GET sha → PUT contents/data.json)
   ════════════════════════════════════════════════════════════════════════ */

const utf8ToBase64 = (str) => btoa(unescape(encodeURIComponent(str)));
const base64ToUtf8 = (b64) => decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));

const ghHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

const ghUrl = (repo) =>
  `https://api.github.com/repos/${repo.trim()}/contents/${DATA_FILE}`;

/* ════════════════════════════════════════════════════════════════════════
   SMALL UI PRIMITIVES
   ════════════════════════════════════════════════════════════════════════ */

const Brackets = ({ children, className = '' }) => (
  <span className={cls('font-mono tracking-tight', className)}>
    <span className="text-zinc-400">[</span>
    {children}
    <span className="text-zinc-400">]</span>
  </span>
);

const Label = ({ children, className = '' }) => (
  <span className={cls('font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500', className)}>
    {children}
  </span>
);

const NeonDot = ({ on = true, color = 'emerald', className = '' }) => {
  const colors = {
    emerald: on ? 'bg-emerald-500 shadow-[0_0_8px_#34d399]' : 'bg-zinc-300',
    amber: on ? 'bg-amber-500 shadow-[0_0_8px_#fbbf24]' : 'bg-zinc-300',
    red: on ? 'bg-red-500 shadow-[0_0_8px_#f87171]' : 'bg-zinc-300',
    cyan: on ? 'bg-cyan-500 shadow-[0_0_8px_#22d3ee]' : 'bg-zinc-300',
  };
  return <span className={cls('inline-block h-1.5 w-1.5 rounded-full', colors[color] || colors.emerald, className)} />;
};

const KbdKey = ({ children, className = '' }) => (
  <kbd className={cls(
    'inline-flex items-center justify-center px-1.5 min-w-[20px] h-5 font-mono text-[10px] font-bold',
    'border border-zinc-300 bg-white text-zinc-700 shadow-[0_1px_0_0_rgba(24,24,27,0.08)] rounded-[3px]',
    className
  )}>
    {children}
  </kbd>
);

const Btn = ({ children, onClick, variant = 'ghost', className = '', disabled, type, title, size = 'md' }) => {
  const base = 'inline-flex items-center justify-center gap-1.5 font-mono uppercase tracking-[0.14em] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed select-none';
  const sizes = {
    sm: 'text-[10px] px-2 py-1',
    md: 'text-[11px] px-2.5 py-1.5',
    lg: 'text-[12px] px-3.5 py-2',
  };
  const variants = {
    ghost: 'border border-zinc-200 text-zinc-800 hover:border-emerald-500/60 hover:text-emerald-700 hover:bg-emerald-500/[0.04]',
    primary: 'border border-emerald-500/70 bg-emerald-500/[0.08] text-emerald-700 hover:bg-emerald-500/20 hover:shadow-[0_0_18px_-2px_#10b981] hover:border-emerald-400',
    danger: 'border border-zinc-200 text-zinc-500 hover:border-red-500/60 hover:text-red-600 hover:bg-red-500/[0.04]',
    warn: 'border border-amber-500/40 bg-amber-500/[0.06] text-amber-700 hover:bg-amber-500/20 hover:border-amber-500',
    bare: 'text-zinc-500 hover:text-emerald-700 px-1.5 py-1',
    solid: 'border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:border-emerald-700 shadow-[0_0_18px_-4px_#10b981]',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      type={type || 'button'}
      title={title}
      className={cls(base, sizes[size], variants[variant], className)}
    >
      {children}
    </button>
  );
};

const Input = React.forwardRef(({ className = '', ...props }, ref) => (
  <input
    ref={ref}
    {...props}
    className={cls(
      'bg-zinc-50 border border-zinc-200 px-2.5 py-1.5 font-mono text-[12px] text-zinc-900 placeholder:text-zinc-400',
      'focus:outline-none focus:border-emerald-500/60 focus:bg-emerald-500/[0.02] focus:shadow-[0_0_0_1px_rgba(16,185,129,0.2)] transition-all duration-150',
      className
    )}
  />
));

const IconBtn = ({ icon: Icon, onClick, title, active, className = '' }) => (
  <button
    onClick={onClick}
    title={title}
    className={cls(
      'inline-flex items-center justify-center h-7 w-7 border transition-all duration-150',
      active
        ? 'border-emerald-500/60 bg-emerald-500/[0.08] text-emerald-700'
        : 'border-zinc-200 text-zinc-500 hover:border-emerald-500/40 hover:text-emerald-700',
      className
    )}
  >
    <Icon className="h-3.5 w-3.5" />
  </button>
);

/* ════════════════════════════════════════════════════════════════════════
   MODAL — backdrop + center card, esc / click-outside
   ════════════════════════════════════════════════════════════════════════ */

function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', icon: Icon }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 animate-[fadeIn_0.15s_ease-out]">
      <div className="absolute inset-0 bg-zinc-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className={cls(
        'relative w-full bg-white border border-zinc-200 shadow-[0_24px_60px_-12px_rgba(24,24,27,0.18)] animate-[slideDown_0.2s_ease-out]',
        widths[size]
      )}>
        {title && (
          <div className="flex items-start gap-3 border-b border-zinc-200 px-4 py-3">
            {Icon && (
              <div className="h-8 w-8 border border-emerald-500/40 bg-emerald-500/[0.06] flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-emerald-700" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="font-mono text-[13px] font-bold tracking-[0.16em] uppercase text-zinc-900">
                {title}
              </h2>
              {subtitle && <p className="text-[12px] text-zinc-500 mt-0.5">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900 transition-colors shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div>{children}</div>
        {footer && <div className="border-t border-zinc-200 px-4 py-3 bg-zinc-50/60">{footer}</div>}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SPARKLINE — compact SVG line chart with optional area fill
   ════════════════════════════════════════════════════════════════════════ */

function Sparkline({ data = [], color = '#10b981', area = true, height = 32, showDot = true, strokeWidth = 1.5 }) {
  if (!data || data.length === 0) {
    return <div className="text-[10px] text-zinc-400 font-mono py-2">no data</div>;
  }
  if (data.length === 1) data = [0, data[0]];

  const w = 100;
  const h = height;
  const min = Math.min(0, ...data);
  const max = Math.max(...data, 1);
  const range = max - min || 1;
  const stepX = w / (data.length - 1);

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * h * 0.85 - h * 0.075;
    return [x, y];
  });

  const path = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${path} L${w},${h} L0,${h} Z`;
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height, overflow: 'visible' }}>
      {area && <path d={areaPath} fill={color} opacity="0.12" />}
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {showDot && (
        <circle cx={last[0]} cy={last[1]} r="2" fill={color}>
          <animate attributeName="r" values="2;3;2" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   YEAR HEATMAP — GitHub-style 53×7 grid
   ════════════════════════════════════════════════════════════════════════ */

function YearHeatmap({ dayValues = {}, max = 1, color = 'emerald' }) {
  // dayValues: { 'YYYY-MM-DD': intensity (0..1 or count) }
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build 365 days back from today, weeks first
  const cells = [];
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 364);
  // Align to Monday
  const startDay = startDate.getDay() === 0 ? 6 : startDate.getDay() - 1;
  startDate.setDate(startDate.getDate() - startDay);

  let cursor = new Date(startDate);
  const monthLabels = [];
  let lastMonth = -1;

  for (let w = 0; w < 54; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const k = dateKey(cursor);
      const inRange = cursor <= today && cursor >= new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
      week.push({
        key: k,
        value: dayValues[k] || 0,
        inRange,
        date: new Date(cursor),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    cells.push(week);
    // Capture month start
    const firstDay = week[0].date;
    if (firstDay.getMonth() !== lastMonth && firstDay.getDate() <= 7) {
      monthLabels.push({ idx: w, month: firstDay.getMonth() });
      lastMonth = firstDay.getMonth();
    }
  }

  const intensityClass = (v) => {
    if (!v) return 'bg-zinc-100 border-zinc-200';
    const r = clamp(v / max, 0, 1);
    if (color === 'emerald') {
      if (r < 0.25) return 'bg-emerald-200 border-emerald-300';
      if (r < 0.5) return 'bg-emerald-300 border-emerald-400';
      if (r < 0.75) return 'bg-emerald-500 border-emerald-600';
      return 'bg-emerald-600 border-emerald-700 shadow-[0_0_4px_#10b981]';
    }
    if (color === 'amber') {
      if (r < 0.5) return 'bg-amber-300 border-amber-400';
      return 'bg-amber-500 border-amber-600';
    }
    return 'bg-emerald-500 border-emerald-600';
  };

  const CELL = 10;
  const GAP = 2;

  return (
    <div className="overflow-x-auto scrollbar-none">
      <div style={{ minWidth: (CELL + GAP) * 54 + 20 }}>
        {/* Month axis */}
        <div className="relative h-3 mb-1 ml-4">
          {monthLabels.map((m) => (
            <span
              key={m.idx}
              className="absolute font-mono text-[9px] text-zinc-400 uppercase tracking-wider"
              style={{ left: m.idx * (CELL + GAP) }}
            >
              {MONTHS_SHORT[m.month]}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          {/* Day labels */}
          <div className="flex flex-col gap-[2px] mt-[1px]">
            {['M','','W','','F','',''].map((d, i) => (
              <span key={i} className="font-mono text-[8px] text-zinc-400 h-[10px] leading-[10px] flex items-center" style={{ width: 10 }}>
                {d}
              </span>
            ))}
          </div>
          {/* Cells */}
          <div className="flex gap-[2px]">
            {cells.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[2px]">
                {week.map((c) => (
                  <div
                    key={c.key}
                    title={c.inRange ? `${c.key}: ${c.value}` : ''}
                    className={cls(
                      'border transition-colors',
                      c.inRange ? intensityClass(c.value) : 'border-transparent'
                    )}
                    style={{ width: CELL, height: CELL }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MINI HEATMAP — compact recent N weeks (for dashboard)
   ════════════════════════════════════════════════════════════════════════ */

function MiniHeatmap({ habits, weeks, weekCount = 8 }) {
  const today = new Date();
  const weekKeys = useMemo(() => {
    const arr = [];
    for (let i = weekCount - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 7);
      arr.push(getWeekKey(d));
    }
    return arr;
  }, [weekCount]);

  return (
    <div className="space-y-1">
      {habits.slice(0, 6).map((h) => {
        const cells = weekKeys.flatMap((wk) => {
          const w = weeks[wk]?.[h.id] || {};
          return DAY_KEYS.map((dk) => !!w[dk]);
        });
        return (
          <div key={h.id} className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-700 w-20 truncate uppercase tracking-wider">
              {h.emoji && <span className="mr-1">{h.emoji}</span>}
              {h.name}
            </span>
            <div className="flex gap-[2px] flex-1">
              {cells.map((on, i) => (
                <div
                  key={i}
                  className={cls(
                    'h-2.5 flex-1 min-w-[3px] border',
                    on ? 'bg-emerald-500 border-emerald-600 shadow-[0_0_3px_#10b981]' : 'bg-zinc-100 border-zinc-200'
                  )}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   PANEL & EMPTY STATE
   ════════════════════════════════════════════════════════════════════════ */

function Panel({ title, right, children, className = '', dense, accent }) {
  return (
    <section className={cls(
      'border border-zinc-200 bg-white/90 shadow-[0_1px_2px_rgba(24,24,27,0.04)]',
      dense ? 'p-3' : 'p-4',
      className
    )}>
      {(title || right) && (
        <div className={cls('flex items-center justify-between', dense ? 'mb-3' : 'mb-4')}>
          {title && (
            <div className="flex items-center gap-2">
              <NeonDot color={accent || 'emerald'} />
              <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-800 font-bold">
                {title}
              </h3>
            </div>
          )}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="h-10 w-10 border border-zinc-200 bg-zinc-50 flex items-center justify-center mb-3">
        <Icon className="h-4 w-4 text-zinc-400" />
      </div>
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-700">{title}</div>
      {subtitle && <div className="mt-1 text-[11px] text-zinc-500 max-w-xs">{subtitle}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   STATUS BAR — top strip with clock, version, sync state
   ════════════════════════════════════════════════════════════════════════ */

function StatusBar({ time, lastSync, syncing, openPalette }) {
  const sinceSync = useMemo(() => {
    if (!lastSync) return 'NEVER';
    const diff = Date.now() - new Date(lastSync).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'JUST NOW';
    if (m < 60) return `${m}M AGO`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}H AGO`;
    return `${Math.floor(h / 24)}D AGO`;
  }, [lastSync, time]);

  return (
    <div className="border-b border-zinc-200 bg-white/70 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <NeonDot on={!syncing} color={syncing ? 'amber' : 'emerald'} />
            <span className="text-zinc-700">SYSTEM</span>
            <span className={syncing ? 'text-amber-600' : 'text-emerald-600'}>
              {syncing ? 'SYNCING' : 'OPERATIONAL'}
            </span>
          </span>
          <span className="hidden sm:inline text-zinc-300">│</span>
          <span className="hidden sm:flex items-center gap-1.5">
            <span className="text-zinc-500">PROTOCOL</span>
            <span className="text-zinc-800">v8.0.0</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={openPalette}
            className="hidden sm:flex items-center gap-1.5 text-zinc-500 hover:text-emerald-700 transition-colors"
            title="Open command palette"
          >
            <span>SEARCH</span>
            <KbdKey>⌘</KbdKey>
            <KbdKey>K</KbdKey>
          </button>
          <span className="hidden sm:inline text-zinc-300">│</span>
          <span className="hidden md:flex items-center gap-1.5">
            <span className="text-zinc-500">SYNC</span>
            <span className="text-zinc-800 tabular-nums">{sinceSync}</span>
          </span>
          <span className="hidden md:inline text-zinc-300">│</span>
          <span className="tabular-nums text-zinc-800">
            {time.toLocaleTimeString('en-GB', { hour12: false })}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   HEADER — brand, github, nav, action icons
   ════════════════════════════════════════════════════════════════════════ */

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Command', icon: LayoutDashboard, shortcut: '1' },
  { id: 'nova', label: 'Nova', icon: Workflow, shortcut: '2' },
  { id: 'jobs', label: 'Hunt', icon: Crosshair, shortcut: '3' },
  { id: 'habits', label: 'Habits', icon: Flame, shortcut: '4' },
  { id: 'finance', label: 'Finance', icon: Wallet, shortcut: '5' },
  { id: 'general', label: 'Tasks', icon: ListTodo, shortcut: '6' },
];

function Header({ view, setView, data, updateSettings, pushGh, pullGh, syncing, openSettings, openHelp }) {
  const [showToken, setShowToken] = useState(false);

  return (
    <header className="border-b border-zinc-200 bg-white/85 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto max-w-[1400px] px-5 py-3">
        {/* Top row: brand + github */}
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative">
              <div className="h-9 w-9 border border-emerald-500/60 bg-emerald-500/10 flex items-center justify-center shadow-[0_0_18px_-4px_#10b981]">
                <Terminal className="h-4 w-4 text-emerald-700" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_6px_#34d399]" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="font-mono text-sm font-bold tracking-[0.2em] text-zinc-900 leading-none">
                LIFE_OS<span className="text-emerald-600">.</span>PROTOCOL
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500 mt-1">
                personal operating system <span className="text-zinc-300">//</span> v8
              </div>
            </div>
          </div>

          {/* GitHub control cluster */}
          <div className="flex items-center gap-2">
            <div className="hidden lg:flex items-center gap-1.5 border border-zinc-200 bg-zinc-50 pl-2 pr-1 py-1">
              <Github className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <Input
                value={data.settings.githubRepo}
                onChange={(e) => updateSettings({ githubRepo: e.target.value })}
                placeholder="user/repo"
                className="!border-0 !bg-transparent !px-1 !py-0.5 w-32"
              />
              <span className="text-zinc-300">│</span>
              <Input
                type={showToken ? 'text' : 'password'}
                value={data.settings.githubToken}
                onChange={(e) => updateSettings({ githubToken: e.target.value })}
                placeholder="ghp_••••••••"
                className="!border-0 !bg-transparent !px-1 !py-0.5 w-32"
              />
              <button
                onClick={() => setShowToken((s) => !s)}
                className="p-1 text-zinc-400 hover:text-emerald-700"
                title={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>

            <Btn onClick={pullGh} disabled={syncing} title="Pull data.json from GitHub">
              <ArrowDownToLine className="h-3 w-3" />
              <span className="hidden md:inline">Pull</span>
            </Btn>
            <Btn onClick={pushGh} disabled={syncing} variant="primary" title="Sync local state to GitHub (⌘S)">
              {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUpToLine className="h-3 w-3" />}
              <span>Sync</span>
            </Btn>
            <div className="hidden md:flex items-center gap-1 border-l border-zinc-200 pl-2 ml-1">
              <IconBtn icon={Gear} onClick={openSettings} title="Settings & data" />
              <IconBtn icon={Keyboard} onClick={openHelp} title="Keyboard shortcuts (?)" />
            </div>
          </div>
        </div>

        {/* Mobile GitHub bar */}
        <div className="lg:hidden flex flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-1.5 border border-zinc-200 bg-zinc-50 pl-2 pr-1 py-1 flex-1 min-w-[180px]">
            <Github className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
            <Input
              value={data.settings.githubRepo}
              onChange={(e) => updateSettings({ githubRepo: e.target.value })}
              placeholder="user/repo"
              className="!border-0 !bg-transparent !px-1 !py-0.5 flex-1 min-w-0"
            />
          </div>
          <div className="flex items-center gap-1.5 border border-zinc-200 bg-zinc-50 pl-2 pr-1 py-1 flex-1 min-w-[200px]">
            <Hash className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
            <Input
              type={showToken ? 'text' : 'password'}
              value={data.settings.githubToken}
              onChange={(e) => updateSettings({ githubToken: e.target.value })}
              placeholder="ghp_••••••••"
              className="!border-0 !bg-transparent !px-1 !py-0.5 flex-1 min-w-0"
            />
            <button
              onClick={() => setShowToken((s) => !s)}
              className="p-1 text-zinc-500 hover:text-emerald-700"
            >
              {showToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          </div>
        </div>

        {/* Nav tabs */}
        <nav className="flex items-end gap-1 overflow-x-auto -mb-px scrollbar-none">
          {NAV_ITEMS.map((item, idx) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={cls(
                  'group relative flex items-center gap-2 border border-b-0 px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-all duration-150 shrink-0',
                  active
                    ? 'border-zinc-200 bg-white text-emerald-700'
                    : 'border-transparent text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100/50'
                )}
                title={`${item.label} (press ${item.shortcut})`}
              >
                <span className={cls('font-mono text-[9px] tabular-nums', active ? 'text-emerald-600' : 'text-zinc-400')}>
                  {pad(idx + 1)}
                </span>
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
                {active && <span className="absolute -bottom-px left-0 right-0 h-px bg-emerald-500 shadow-[0_0_8px_#34d399]" />}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   PAGE FRAME — section header
   ════════════════════════════════════════════════════════════════════════ */

function PageFrame({ index, title, subtitle, actions, children }) {
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6">
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <Brackets className="text-emerald-600 text-xs">{pad(index)} / 06</Brackets>
            <span className="h-px flex-1 bg-zinc-200 min-w-8 max-w-[200px]" />
            <Label>module</Label>
          </div>
          <h1 className="font-mono text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900">
            {title}<span className="text-emerald-600">.</span>
          </h1>
          {subtitle && <p className="mt-1 text-sm text-zinc-500 max-w-2xl">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   COMMAND PALETTE — ⌘K fuzzy finder across all entities
   ════════════════════════════════════════════════════════════════════════ */

function CommandPalette({ open, onClose, data, setView, setData, showToast, openSettings, openHelp, pushGh, pullGh }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const items = useMemo(() => {
    const all = [];

    // Navigation actions
    NAV_ITEMS.forEach((n, i) => {
      all.push({
        type: 'nav',
        title: `Go to ${n.label}`,
        subtitle: `Switch to module ${pad(i + 1)}`,
        icon: n.icon,
        action: () => setView(n.id),
        keywords: `nav navigate go ${n.label} ${n.id} module`,
        shortcut: n.shortcut,
      });
    });

    // Quick actions
    all.push(
      { type: 'action', title: 'Sync to GitHub', subtitle: 'Push current state to repository', icon: ArrowUpToLine, action: pushGh, keywords: 'sync push github save upload', shortcut: '⌘S' },
      { type: 'action', title: 'Pull from GitHub', subtitle: 'Pull data.json from repository', icon: ArrowDownToLine, action: pullGh, keywords: 'pull download github restore fetch' },
      { type: 'action', title: 'Open Settings', subtitle: 'Export, import, wipe data', icon: Gear, action: openSettings, keywords: 'settings preferences config' },
      { type: 'action', title: 'Keyboard Shortcuts', subtitle: 'View all shortcuts', icon: Keyboard, action: openHelp, keywords: 'help keyboard shortcuts ?' },
    );

    // Nova tasks
    data.nova.tasks.filter(t => !t.completed).forEach((t) => {
      const cat = data.nova.categories.find((c) => c.id === t.categoryId);
      all.push({
        type: 'nova',
        title: t.title,
        subtitle: `Nova · ${cat?.name || 'Uncategorized'}${t.priority ? ' · Priority' : ''}`,
        icon: Workflow,
        action: () => setView('nova'),
        keywords: `task nova ${t.title} ${cat?.name || ''} ${t.priority ? 'priority urgent' : ''} ${(t.tags || []).join(' ')}`,
      });
    });

    // Jobs
    data.jobs.cards.forEach((c) => {
      const col = data.jobs.columns.find((x) => x.id === c.columnId);
      all.push({
        type: 'job',
        title: c.company,
        subtitle: `Hunt · ${col?.name || ''}${c.role ? ' · ' + c.role : ''}`,
        icon: Crosshair,
        action: () => setView('jobs'),
        keywords: `job hunt ${c.company} ${c.role || ''} ${col?.name || ''} application`,
      });
    });

    // Habits
    data.habits.list.forEach((h) => {
      all.push({
        type: 'habit',
        title: `${h.emoji || ''} ${h.name}`.trim(),
        subtitle: 'Habit · Track or open',
        icon: Flame,
        action: () => setView('habits'),
        keywords: `habit ${h.name} ${h.id} track`,
      });
    });

    // General tasks
    data.generalTasks.filter(t => !t.completed).forEach((t) => {
      all.push({
        type: 'general',
        title: t.title,
        subtitle: 'Personal task',
        icon: ListTodo,
        action: () => setView('general'),
        keywords: `task personal ${t.title}`,
      });
    });

    return all;
  }, [data, setView, pushGh, pullGh, openSettings, openHelp]);

  const filtered = useMemo(() => {
    if (!q.trim()) return items.slice(0, 16);
    const needle = q.toLowerCase().trim();
    const scored = items
      .map((it) => {
        const hay = (it.title + ' ' + (it.subtitle || '') + ' ' + (it.keywords || '')).toLowerCase();
        let score = 0;
        if (it.title.toLowerCase().startsWith(needle)) score += 100;
        else if (it.title.toLowerCase().includes(needle)) score += 60;
        if (hay.includes(needle)) score += 20;
        // Fuzzy: every char appears in order
        let li = 0;
        for (let i = 0; i < needle.length; i++) {
          const f = hay.indexOf(needle[i], li);
          if (f === -1) { score = score - 999; break; }
          li = f + 1;
          score += 1;
        }
        return { it, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 16)
      .map((x) => x.it);
    return scored;
  }, [q, items]);

  useEffect(() => { setSel(0); }, [q]);

  if (!open) return null;

  const run = (it) => {
    if (!it) return;
    it.action();
    onClose();
  };

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(filtered[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  const typeColors = {
    nav: 'text-cyan-700 bg-cyan-50 border-cyan-200',
    action: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    nova: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    job: 'text-amber-700 bg-amber-50 border-amber-200',
    habit: 'text-orange-700 bg-orange-50 border-orange-200',
    general: 'text-zinc-700 bg-zinc-100 border-zinc-200',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 animate-[fadeIn_0.12s_ease-out]">
      <div className="absolute inset-0 bg-zinc-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white border border-zinc-200 shadow-[0_24px_60px_-12px_rgba(24,24,27,0.18)] animate-[slideDown_0.15s_ease-out]">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3">
          <Search className="h-4 w-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Type a command, task, company, habit…"
            className="flex-1 bg-transparent text-zinc-900 placeholder:text-zinc-400 font-mono text-sm focus:outline-none"
          />
          <KbdKey>ESC</KbdKey>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center font-mono text-[11px] uppercase tracking-wider text-zinc-400">
              No matches for "{q}"
            </div>
          ) : (
            filtered.map((it, i) => {
              const Icon = it.icon;
              const isSel = i === sel;
              return (
                <button
                  key={i}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => run(it)}
                  className={cls(
                    'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    isSel ? 'bg-emerald-500/[0.06]' : 'hover:bg-zinc-50'
                  )}
                >
                  <span className={cls(
                    'h-7 w-7 flex items-center justify-center border shrink-0',
                    typeColors[it.type] || typeColors.general
                  )}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-zinc-900 truncate">{it.title}</div>
                    {it.subtitle && (
                      <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 truncate">
                        {it.subtitle}
                      </div>
                    )}
                  </div>
                  {it.shortcut && <KbdKey>{it.shortcut}</KbdKey>}
                  {isSel && <CornerDownLeft className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="border-t border-zinc-200 px-4 py-2 bg-zinc-50/60 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><KbdKey>↑</KbdKey><KbdKey>↓</KbdKey> navigate</span>
            <span className="hidden sm:flex items-center gap-1"><KbdKey>↵</KbdKey> select</span>
          </div>
          <span>{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SHORTCUT HELP modal
   ════════════════════════════════════════════════════════════════════════ */

function ShortcutHelp({ open, onClose }) {
  const groups = [
    {
      title: 'Navigation',
      items: [
        { keys: ['⌘', 'K'], desc: 'Open command palette' },
        { keys: ['/'], desc: 'Quick search' },
        { keys: ['1'], desc: 'Command (Dashboard)' },
        { keys: ['2'], desc: 'Nova workspace' },
        { keys: ['3'], desc: 'Hunt (Jobs)' },
        { keys: ['4'], desc: 'Habits' },
        { keys: ['5'], desc: 'Finance' },
        { keys: ['6'], desc: 'General Tasks' },
      ],
    },
    {
      title: 'Actions',
      items: [
        { keys: ['⌘', 'S'], desc: 'Sync to GitHub' },
        { keys: ['⌘', 'E'], desc: 'Export data (JSON)' },
        { keys: ['Esc'], desc: 'Close modal / palette' },
        { keys: ['?'], desc: 'Show this help' },
      ],
    },
    {
      title: 'In Tasks',
      items: [
        { keys: ['↵'], desc: 'Add task' },
        { keys: ['Double-click'], desc: 'Edit task inline' },
        { keys: ['!'], desc: 'Toggle priority' },
      ],
    },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Keyboard Shortcuts" subtitle="Master the interface" icon={Keyboard} size="lg">
      <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-700 mb-2 pb-1 border-b border-emerald-500/30">
              {g.title}
            </div>
            <div className="space-y-1.5">
              {g.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-zinc-700">{item.desc}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {item.keys.map((k, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && <span className="text-zinc-300 text-[10px]">+</span>}
                        <KbdKey>{k}</KbdKey>
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SETTINGS — export, import, wipe, stats
   ════════════════════════════════════════════════════════════════════════ */

function SettingsModal({ open, onClose, data, setData, showToast }) {
  const fileRef = useRef(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `life-os-${todayLocalISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Data exported', 'success');
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const loaded = JSON.parse(ev.target.result);
        setData({
          ...initialData,
          ...loaded,
          settings: {
            ...initialData.settings,
            ...(loaded.settings || {}),
            githubToken: data.settings.githubToken,
            githubRepo: data.settings.githubRepo,
          },
        });
        showToast('Data imported successfully', 'success');
        onClose();
      } catch (err) {
        showToast(`Import failed: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const wipe = () => {
    setData({
      ...initialData,
      settings: { ...data.settings },
    });
    setConfirmWipe(false);
    showToast('All data wiped', 'info');
    onClose();
  };

  // Stats
  const stats = useMemo(() => ({
    novaTotal: data.nova.tasks.length,
    novaOpen: data.nova.tasks.filter(t => !t.completed).length,
    novaCompleted: data.nova.tasks.filter(t => t.completed).length,
    jobs: data.jobs.cards.length,
    habits: data.habits.list.length,
    months: Object.keys(data.finance.months).length,
    general: data.generalTasks.length,
    activity: (data.activity || []).length,
    dataSize: new Blob([JSON.stringify(data)]).size,
  }), [data]);

  return (
    <Modal open={open} onClose={onClose} title="Settings & Data" subtitle="Manage your operating system" icon={Gear} size="lg">
      <div className="p-4 space-y-5">
        {/* Stats panel */}
        <section>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-700 mb-2 pb-1 border-b border-emerald-500/30">
            System Stats
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ['Nova Tasks', stats.novaTotal, `${stats.novaOpen} open`],
              ['Job Apps', stats.jobs, `${data.jobs.columns.length} columns`],
              ['Habits', stats.habits, `${stats.months} months`],
              ['Data Size', `${(stats.dataSize / 1024).toFixed(1)}`, 'KB'],
            ].map(([l, v, d]) => (
              <div key={l} className="border border-zinc-200 bg-zinc-50/60 p-2.5">
                <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">{l}</div>
                <div className="font-mono text-lg font-bold tabular-nums text-zinc-900 mt-0.5 leading-none">{v}</div>
                <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-400 mt-1">{d}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Data ops */}
        <section>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-700 mb-2 pb-1 border-b border-emerald-500/30">
            Data Operations
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between border border-zinc-200 px-3 py-2.5">
              <div>
                <div className="text-[13px] font-medium text-zinc-900">Export to JSON</div>
                <div className="text-[11px] text-zinc-500">Download full snapshot to your device</div>
              </div>
              <Btn onClick={exportData} variant="primary"><Download className="h-3 w-3" />Export</Btn>
            </div>

            <div className="flex items-center justify-between border border-zinc-200 px-3 py-2.5">
              <div>
                <div className="text-[13px] font-medium text-zinc-900">Import from JSON</div>
                <div className="text-[11px] text-zinc-500">Restore from a previous export</div>
              </div>
              <Btn onClick={() => fileRef.current?.click()}><Upload className="h-3 w-3" />Import</Btn>
              <input ref={fileRef} type="file" accept=".json,application/json" onChange={importData} className="hidden" />
            </div>

            <div className="flex items-center justify-between border border-red-200 bg-red-50/30 px-3 py-2.5">
              <div>
                <div className="text-[13px] font-medium text-red-700">Wipe all data</div>
                <div className="text-[11px] text-red-500">Removes everything except GitHub credentials</div>
              </div>
              {confirmWipe ? (
                <div className="flex items-center gap-2">
                  <Btn onClick={() => setConfirmWipe(false)} size="sm">Cancel</Btn>
                  <Btn onClick={wipe} size="sm" variant="danger" className="!text-red-700 !border-red-400">Confirm</Btn>
                </div>
              ) : (
                <Btn onClick={() => setConfirmWipe(true)} variant="danger"><RotateCcw className="h-3 w-3" />Wipe</Btn>
              )}
            </div>
          </div>
        </section>

        {/* About */}
        <section>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-700 mb-2 pb-1 border-b border-emerald-500/30">
            About
          </div>
          <div className="font-mono text-[11px] text-zinc-600 space-y-1">
            <div className="flex justify-between"><span className="uppercase tracking-wider text-zinc-400">Build</span> <span className="text-zinc-800">v8.0.0</span></div>
            <div className="flex justify-between"><span className="uppercase tracking-wider text-zinc-400">Data Schema</span> <span className="text-zinc-800">v{data.version || 7}</span></div>
            <div className="flex justify-between"><span className="uppercase tracking-wider text-zinc-400">Last Sync</span> <span className="text-zinc-800 tabular-nums">{data.settings.lastSync ? new Date(data.settings.lastSync).toLocaleString('en-GB') : 'never'}</span></div>
          </div>
        </section>
      </div>
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   ACTIVITY FEED — recent action stream
   ════════════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════════════
   BULK IMPORT MODAL — paste many finance lines, preview, commit
   ════════════════════════════════════════════════════════════════════════ */

function BulkImportModal({ open, onClose, setData, showToast, monthHint, cur }) {
  const [text, setText] = useState('');
  const [defaultDate, setDefaultDate] = useState((monthHint || getMonthKey()) + '-15');

  const parsed = useMemo(() => {
    if (!text.trim()) return { ok: [], skipped: [], sectionMap: {} };
    const lines = text.split('\n');
    const ok = [];
    const skipped = [];
    let last = defaultDate + 'T12:00:00.000Z';

    lines.forEach((rawLine, idx) => {
      const trimmed = rawLine.trim();
      if (!trimmed) return;

      // Detect section header to advance default date
      const secM = trimmed.match(/Витрати і доходи\s+1\.(\d{1,2})/);
      if (secM) {
        const mon = parseInt(secM[1]);
        const refY = parseInt(last.slice(0, 4));
        const refM = parseInt(last.slice(5, 7));
        let year = refY;
        if (mon < refM) year = refY + 1;
        last = `${year}-${String(mon).padStart(2, '0')}-01T12:00:00.000Z`;
        return;
      }

      // Detect pure summary line "DD.MM(...)"
      const summary = trimmed.match(/^(\d{1,2})\.(\d{1,2})\s*\(/);
      if (summary) {
        const day = parseInt(summary[1]);
        const mon = parseInt(summary[2]);
        const refY = parseInt(last.slice(0, 4));
        const refM = parseInt(last.slice(5, 7));
        let year = refY;
        if (mon < refM) year = refY + 1;
        last = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00.000Z`;
        return;
      }

      const p = parseFinanceLine(trimmed, last);
      if (p) {
        last = p.date + 'T12:00:00.000Z';
        ok.push(p);
      } else if (!trimmed.startsWith('Баланс') && !/Витрати і доходи/.test(trimmed)) {
        skipped.push({ line: trimmed, idx: idx + 1 });
      }
    });

    return { ok, skipped };
  }, [text, defaultDate]);

  const inc = parsed.ok.filter((p) => p.type === 'income');
  const exp = parsed.ok.filter((p) => p.type === 'expense');
  const tr = parsed.ok.filter((p) => p.type === 'transfer');

  const commit = () => {
    if (parsed.ok.length === 0) return;
    setData((d) => {
      const months = { ...d.finance.months };
      parsed.ok.forEach((e) => {
        const mk = e.date.slice(0, 7);
        const existing = months[mk] || { income: [], expenses: [], transfers: [] };
        const next = {
          income: [...(existing.income || [])],
          expenses: [...(existing.expenses || [])],
          transfers: [...(existing.transfers || [])],
        };
        const entry = { id: uid(), amount: e.amount, date: e.date + 'T12:00:00.000Z' };
        if (e.type === 'income') { entry.source = e.desc; next.income = [entry, ...next.income]; }
        else if (e.type === 'transfer') { entry.goal = e.desc; next.transfers = [entry, ...next.transfers]; }
        else { entry.desc = e.desc; entry.category = ''; next.expenses = [entry, ...next.expenses]; }
        months[mk] = next;
      });
      return { ...d, finance: { ...d.finance, months } };
    });
    logActivity(setData, 'sync', `Bulk-imported ${parsed.ok.length} entries (${inc.length}/${exp.length}/${tr.length})`);
    showToast(`Imported ${parsed.ok.length} entries`, 'success');
    setText('');
    onClose();
  };

  // Group ok entries by month for preview summary
  const monthBuckets = useMemo(() => {
    const m = {};
    parsed.ok.forEach((p) => {
      const mk = p.date.slice(0, 7);
      if (!m[mk]) m[mk] = { in: 0, ex: 0, tr: 0, n: 0 };
      if (p.type === 'income') m[mk].in += p.amount;
      else if (p.type === 'transfer') m[mk].tr += p.amount;
      else m[mk].ex += p.amount;
      m[mk].n++;
    });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [parsed.ok]);

  return (
    <Modal open={open} onClose={onClose} title="Bulk Finance Import" subtitle="Paste a chunk of entries — auto-parsed into income / expenses / transfers" icon={Upload} size="xl">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <Label>Default date for entries without (D.M)</Label>
          <input
            type="date"
            value={defaultDate}
            onChange={(e) => setDefaultDate(e.target.value)}
            className="bg-zinc-50 border border-zinc-200 px-2 py-1 font-mono text-[11px] text-zinc-700 focus:outline-none focus:border-emerald-500/60"
          />
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            Section headers ("Витрати і доходи 1.MM-1.MM") advance the date automatically
          </span>
        </div>

        <div className="grid lg:grid-cols-2 gap-3">
          {/* Input */}
          <div>
            <Label>Paste entries (one per line)</Label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'-30 булочка (1.06)\n+500 мама\nПереказ: 1000 айфон\n-126 мобільний інтернет (8.06)'}
              rows={18}
              className="w-full mt-1 bg-zinc-50 border border-zinc-200 px-3 py-2 font-mono text-[12px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500/60 resize-none"
            />
          </div>

          {/* Preview */}
          <div className="min-h-0 flex flex-col">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <Label>Preview</Label>
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                <span className="text-emerald-700">{inc.length} in</span>
                <span className="text-zinc-300">·</span>
                <span className="text-red-700">{exp.length} out</span>
                <span className="text-zinc-300">·</span>
                <span className="text-cyan-700">{tr.length} transfer</span>
                {parsed.skipped.length > 0 && (
                  <>
                    <span className="text-zinc-300">·</span>
                    <span className="text-amber-700">{parsed.skipped.length} skipped</span>
                  </>
                )}
              </div>
            </div>

            {/* Month buckets */}
            {monthBuckets.length > 0 && (
              <div className="mt-1 mb-2 flex flex-wrap gap-1">
                {monthBuckets.map(([mk, b]) => (
                  <span key={mk} className="font-mono text-[10px] border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-zinc-700">
                    {formatMonth(mk).slice(0, 3)} {mk.slice(2, 4)}: <span className="text-zinc-900">{b.n}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="mt-1 border border-zinc-200 bg-white max-h-[300px] overflow-y-auto">
              {parsed.ok.length === 0 ? (
                <div className="py-10 text-center font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                  Paste text to see preview
                </div>
              ) : (
                <table className="w-full">
                  <tbody>
                    {parsed.ok.map((p, i) => (
                      <tr key={i} className="border-b border-zinc-200/60 last:border-0 hover:bg-zinc-50/60">
                        <td className="px-2 py-1 font-mono text-[10px] text-zinc-500 tabular-nums whitespace-nowrap">
                          {p.date.slice(5)}
                        </td>
                        <td className="px-1 py-1">
                          <span className={cls(
                            'font-mono text-[9px] uppercase px-1.5 py-0.5 border',
                            p.type === 'income' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
                            p.type === 'transfer' ? 'text-cyan-700 bg-cyan-50 border-cyan-200' :
                            'text-red-700 bg-red-50 border-red-200'
                          )}>
                            {p.type === 'income' ? 'IN' : p.type === 'transfer' ? 'TR' : 'OUT'}
                          </span>
                        </td>
                        <td className="px-2 py-1 font-mono text-[11px] tabular-nums text-zinc-900 text-right whitespace-nowrap">
                          {fmtNum(p.amount)}
                        </td>
                        <td className="px-2 py-1 text-[11px] text-zinc-700 truncate max-w-[200px]">
                          {p.desc}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {parsed.skipped.length > 0 && (
              <div className="mt-2 border border-amber-300 bg-amber-50/40 p-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-amber-700 mb-1">
                  Skipped {parsed.skipped.length}:
                </div>
                <div className="space-y-0.5 max-h-20 overflow-y-auto">
                  {parsed.skipped.slice(0, 8).map((s, i) => (
                    <div key={i} className="font-mono text-[10px] text-amber-800 truncate">
                      line {s.idx}: {s.line.slice(0, 80)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-zinc-200 bg-zinc-50/60 flex items-center justify-between gap-2 flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {parsed.ok.length} parseable across {monthBuckets.length} month{monthBuckets.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          <Btn onClick={() => setText('')} disabled={!text}>Clear</Btn>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn onClick={commit} variant="primary" disabled={parsed.ok.length === 0}>
            <Upload className="h-3 w-3" /> Import {parsed.ok.length}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

const ACTIVITY_ICONS = {
  task_added: { icon: Plus, color: 'text-emerald-600 border-emerald-500/40 bg-emerald-500/[0.06]' },
  task_done: { icon: Check, color: 'text-emerald-600 border-emerald-500/40 bg-emerald-500/[0.06]' },
  task_deleted: { icon: Trash2, color: 'text-red-600 border-red-500/40 bg-red-500/[0.04]' },
  job_added: { icon: Crosshair, color: 'text-amber-700 border-amber-500/40 bg-amber-500/[0.06]' },
  job_moved: { icon: ArrowRight, color: 'text-cyan-700 border-cyan-500/40 bg-cyan-500/[0.06]' },
  habit_check: { icon: Flame, color: 'text-orange-600 border-orange-400/40 bg-orange-500/[0.06]' },
  finance_in: { icon: TrendingUp, color: 'text-emerald-600 border-emerald-500/40 bg-emerald-500/[0.06]' },
  finance_out: { icon: TrendingDown, color: 'text-red-600 border-red-500/40 bg-red-500/[0.04]' },
  sync: { icon: ArrowUpToLine, color: 'text-emerald-700 border-emerald-500/40 bg-emerald-500/[0.06]' },
  default: { icon: ActivityIcon, color: 'text-zinc-600 border-zinc-300 bg-zinc-50' },
};

function ActivityFeed({ log, limit = 10 }) {
  const items = (log || []).slice(0, limit);
  if (items.length === 0) {
    return <EmptyState icon={ActivityIcon} title="No activity yet" subtitle="Actions will appear here as you use the system." />;
  }
  return (
    <div className="space-y-1.5">
      {items.map((item) => {
        const { icon: Icon, color } = ACTIVITY_ICONS[item.type] || ACTIVITY_ICONS.default;
        return (
          <div key={item.id} className="flex items-start gap-2.5 py-1">
            <span className={cls('h-6 w-6 border flex items-center justify-center shrink-0 mt-0.5', color)}>
              <Icon className="h-3 w-3" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] text-zinc-800 leading-tight">{item.text}</div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-400 mt-0.5">
                {timeAgo(item.ts)} ago
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   DASHBOARD — KPIs + sparklines + heatmap + activity
   ════════════════════════════════════════════════════════════════════════ */

function Dashboard({ data, setView, setData, showToast, openPalette }) {
  const today = new Date();
  const todayKey = dateKey(today);
  const monthKey = getMonthKey(today);

  // Nova metrics
  const novaOpen = data.nova.tasks.filter((t) => !t.completed);
  const novaToday = novaOpen.filter((t) => {
    if (t.dueDate) return t.dueDate === todayKey;
    return t.createdAt && t.createdAt.slice(0, 10) === todayKey;
  });
  const novaPriority = novaOpen.filter((t) => t.priority);
  const novaOverdue = novaOpen.filter((t) => t.dueDate && t.dueDate < todayKey);

  // Habits this week
  const wk = getWeekKey();
  const habitsWeek = data.habits.weeks[wk] || {};
 const habitCells = data.habits.list.length * 7;
const habitDone = data.habits.list.reduce((acc, h) => {
  const w = habitsWeek[h.id] || {};
  return acc + DAY_KEYS.filter((d) => w[d]).length;
}, 0);
const habitTargetsTotal = data.habits.list.reduce((s, h) => s + (h.target || 7), 0);
const habitTargetProgress = data.habits.list.reduce((acc, h) => {
  const w = habitsWeek[h.id] || {};
  const done = DAY_KEYS.filter((d) => w[d]).length;
  return acc + Math.min(done, h.target || 7);
}, 0);
const habitPct = habitTargetsTotal > 0
  ? Math.round((habitTargetProgress / habitTargetsTotal) * 100)
  : 0;

  // Jobs metrics
  const jobsByCol = useMemo(() => {
    const m = {};
    data.jobs.columns.forEach((c) => m[c.id] = []);
    data.jobs.cards.forEach((c) => { (m[c.columnId] = m[c.columnId] || []).push(c); });
    return m;
  }, [data.jobs]);
  const activeJobs = data.jobs.cards.length;
  const offers = (jobsByCol.offer || []).length;
  const interviewing = (jobsByCol.interviewing || []).length;

  // Finance current month
  const fmonth = useMemo(() => {
    const m = data.finance.months[monthKey] || {};
    return { income: m.income || [], expenses: m.expenses || [], transfers: m.transfers || [] };
  }, [data.finance.months, monthKey]);
  const totalIncome = fmonth.income.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const totalExpenses = fmonth.expenses.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const totalTransfers = fmonth.transfers.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const balance = totalIncome - totalExpenses - totalTransfers;
  const limit = data.finance.limit || 0;
  const limitPct = limit > 0 ? Math.round((totalExpenses / limit) * 100) : 0;
  const cur = data.finance.currency || 'UAH';

  // Sparkline: last 7 days finance
  const last7Spend = useMemo(() => {
    const arr = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const mk = getMonthKey(d);
      const dk = dateKey(d);
      const m = data.finance.months[mk] || { expenses: [] };
      const sum = (m.expenses || [])
        .filter((x) => (x.date || '').slice(0, 10) === dk)
        .reduce((s, x) => s + (Number(x.amount) || 0), 0);
      arr.push(sum);
    }
    return arr;
  }, [data.finance.months]);

  // NEW: Cumulative balance trend for current month (running net day-by-day)
  const monthBalanceTrend = useMemo(() => {
    const [y, m] = monthKey.split('-').map(Number);
    const dayMax = new Date(y, m, 0).getDate();
    const todayDay = today.getDate();
    const upto = monthKey === getMonthKey() ? todayDay : dayMax;
    const arr = [];
    let running = 0;
    for (let day = 1; day <= upto; day++) {
      const dk = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayIn = fmonth.income
        .filter((x) => (x.date || '').slice(0, 10) === dk)
        .reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const dayEx = fmonth.expenses
        .filter((x) => (x.date || '').slice(0, 10) === dk)
        .reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const dayTr = fmonth.transfers
        .filter((x) => (x.date || '').slice(0, 10) === dk)
        .reduce((s, x) => s + (Number(x.amount) || 0), 0);
      running += dayIn - dayEx - dayTr;
      arr.push(running);
    }
    return arr.length > 0 ? arr : [0];
  }, [fmonth, monthKey]);

  // Sparkline: 8 weeks habit completion
  const habitTrend = useMemo(() => {
    const arr = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 7);
      const wkey = getWeekKey(d);
      const wd = data.habits.weeks[wkey] || {};
      let done = 0;
      data.habits.list.forEach((h) => {
        const wk = wd[h.id] || {};
        done += DAY_KEYS.filter((dk) => wk[dk]).length;
      });
      arr.push(done);
    }
    return arr;
  }, [data.habits.weeks, data.habits.list]);

  // Sparkline: nova completion last 7 days
  const novaTrend = useMemo(() => {
    const arr = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dk = dateKey(d);
      const n = data.nova.tasks.filter((t) => t.completed && (t.completedAt || '').slice(0, 10) === dk).length;
      arr.push(n);
    }
    return arr;
  }, [data.nova.tasks]);

  // Sparkline: jobs added per week
  const jobsTrend = useMemo(() => {
    const arr = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 7);
      const wkStart = startOfWeek(d).getTime();
      const wkEnd = wkStart + 7 * 86400000;
      const n = data.jobs.cards.filter((c) => {
        const ct = new Date(c.createdAt || 0).getTime();
        return ct >= wkStart && ct < wkEnd;
      }).length;
      arr.push(n);
    }
    return arr;
  }, [data.jobs.cards]);

  // Habit year heatmap data
  const habitYearMap = useMemo(() => {
    const map = {};
    Object.entries(data.habits.weeks).forEach(([wk, byHabit]) => {
      const [y, m, d] = wk.split('-').map(Number);
      const start = new Date(y, m - 1, d);
      DAY_KEYS.forEach((dk, di) => {
        const day = new Date(start);
        day.setDate(day.getDate() + di);
        const k = dateKey(day);
        let count = 0;
        Object.values(byHabit).forEach((wkData) => { if (wkData[dk]) count++; });
        if (count > 0) map[k] = (map[k] || 0) + count;
      });
    });
    return map;
  }, [data.habits.weeks]);

  const maxHabit = data.habits.list.length;

  // Conversion funnel
  const funnel = useMemo(() => {
    const cols = data.jobs.columns;
    const counts = cols.map((c) => (jobsByCol[c.id] || []).length);
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    return cols.map((c, i) => ({
      name: c.name,
      count: counts[i],
      pct: Math.round((counts[i] / total) * 100),
    }));
  }, [jobsByCol, data.jobs.columns]);

  const novaCompletedToday = data.nova.tasks.filter((t) => t.completed && (t.completedAt || '').slice(0, 10) === todayKey).length;

  return (
    <PageFrame
      index={1}
      title="Command Center"
      subtitle="Daily mission control. Today's pulse, weekly trends, conversion funnels — all at a glance."
      actions={
        <>
          <Btn onClick={openPalette}><Search className="h-3 w-3" />Search<KbdKey className="ml-1">⌘K</KbdKey></Btn>
          <Btn onClick={() => setView('nova')} variant="primary"><Plus className="h-3 w-3" />Quick task</Btn>
        </>
      }
    >
      {/* KPI row */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        <KpiCard
          label="Nova / Today"
          value={novaToday.length}
          unit="tasks"
          detail={`${novaPriority.length} priority · ${novaCompletedToday} done today${novaOverdue.length ? ' · ' + novaOverdue.length + ' overdue' : ''}`}
          icon={Workflow}
          accent={novaOverdue.length > 0 ? 'red' : 'emerald'}
          progress={novaToday.length > 0 ? (novaCompletedToday / (novaCompletedToday + novaToday.length)) * 100 : 0}
          spark={novaTrend}
          sparkColor="#10b981"
          onClick={() => setView('nova')}
        />
        <KpiCard
          label="Habits / Week"
          value={habitPct}
          unit="%"
          detail={`${habitDone} of ${habitCells} cells filled this week`}
          icon={Flame}
          accent={habitPct >= 70 ? 'emerald' : habitPct >= 40 ? 'amber' : 'red'}
          progress={habitPct}
          spark={habitTrend}
          sparkColor="#f59e0b"
          onClick={() => setView('habits')}
        />
        <KpiCard
          label="Active Hunts"
          value={activeJobs}
          unit="apps"
          detail={`${interviewing} interviewing · ${offers} offer${offers !== 1 ? 's' : ''}`}
          icon={Crosshair}
          accent="cyan"
          spark={jobsTrend}
          sparkColor="#06b6d4"
          onClick={() => setView('jobs')}
        />
        <KpiCard
          label="Net Balance"
          value={fmtNum(balance)}
          unit={cur}
          detail={`${limitPct}% of ${fmtNum(limit)} cap used`}
          icon={Wallet}
          accent={balance < 0 ? 'red' : limitPct > 80 ? 'amber' : 'emerald'}
          progress={limitPct}
          spark={last7Spend}
          sparkColor={limitPct > 80 ? '#f59e0b' : '#10b981'}
          onClick={() => setView('finance')}
        />
      </div>

      {/* Habits heatmap full-width */}
      <Panel
        title="Habits.Heatmap"
        right={
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              {Object.keys(habitYearMap).length} active days
            </span>
            <Btn size="sm" onClick={() => setView('habits')}>open<ArrowRight className="h-3 w-3" /></Btn>
          </div>
        }
        className="mb-4"
      >
        <YearHeatmap dayValues={habitYearMap} max={maxHabit} />
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-200/60">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">365-day view</span>
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <span>Less</span>
            <span className="h-2.5 w-2.5 bg-zinc-100 border border-zinc-200" />
            <span className="h-2.5 w-2.5 bg-emerald-200 border border-emerald-300" />
            <span className="h-2.5 w-2.5 bg-emerald-300 border border-emerald-400" />
            <span className="h-2.5 w-2.5 bg-emerald-500 border border-emerald-600" />
            <span className="h-2.5 w-2.5 bg-emerald-600 border border-emerald-700" />
            <span>More</span>
          </div>
        </div>
      </Panel>

      {/* Mid row: Today's focus + Hunt pipeline + Habits pulse */}
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-3 mb-4">
        <Panel
          title="Today.Focus"
          right={<span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 tabular-nums">{novaToday.length} OPEN</span>}
          className="lg:col-span-1"
        >
          {novaToday.length === 0 && novaPriority.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Clear queue" subtitle="No Nova tasks for today." />
          ) : (
            <div className="space-y-1.5">
              {[...novaToday.slice(0, 3), ...novaPriority.filter((p) => !novaToday.find((t) => t.id === p.id)).slice(0, 4)]
                .slice(0, 6)
                .map((t) => {
                  const cat = data.nova.categories.find((c) => c.id === t.categoryId);
                  return (
                    <button
                      key={t.id}
                      onClick={() => setView('nova')}
                      className="w-full flex items-center gap-2.5 border border-zinc-200 bg-zinc-50/60 px-2.5 py-1.5 hover:border-emerald-500/40 hover:bg-emerald-500/[0.04] transition-colors text-left"
                    >
                      <div className={cls(
                        'h-1.5 w-1.5 rounded-full shrink-0',
                        t.priority ? 'bg-amber-500 shadow-[0_0_4px_#f59e0b]' : 'bg-emerald-500'
                      )} />
                      <span className="text-[12px] text-zinc-800 truncate flex-1">{t.title}</span>
                      {cat && (
                        <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 shrink-0">
                          {cat.name}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          )}
        </Panel>

        <Panel
          title="Hunt.Funnel"
          right={<span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 tabular-nums">{activeJobs} TOTAL</span>}
        >
          {activeJobs === 0 ? (
            <EmptyState icon={Crosshair} title="Pipeline empty" subtitle="Add your first job application." />
          ) : (
            <div className="space-y-2.5">
              {funnel.map((f, i) => (
                <div key={f.name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-700 flex items-center gap-1.5">
                      <span className="text-zinc-400 tabular-nums">{pad(i + 1)}</span>
                      {f.name}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-zinc-800">
                      {f.count} <span className="text-zinc-400">·</span> {f.pct}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-100 overflow-hidden">
                    <div
                      className={cls(
                        'h-full transition-all duration-500 shadow-[0_0_6px_-1px_#10b981]',
                        i === 0 ? 'bg-zinc-400' :
                        i === 1 ? 'bg-cyan-500' :
                        i === 2 ? 'bg-amber-500' :
                        'bg-emerald-500'
                      )}
                      style={{ width: `${f.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Habits.Pulse"
          right={<span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 tabular-nums">8 WEEKS</span>}
        >
          {data.habits.list.length === 0 ? (
            <EmptyState icon={Flame} title="No habits tracked" />
          ) : (
            <MiniHeatmap habits={data.habits.list} weeks={data.habits.weeks} weekCount={8} />
          )}
        </Panel>
      </div>

      {/* Bottom row: Finance + Activity */}
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-3 mb-4">
        <Panel
          title="Finance.Pulse"
          right={
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                {formatMonth(monthKey)}
              </span>
              <Btn size="sm" onClick={() => setView('finance')}>open<ArrowRight className="h-3 w-3" /></Btn>
            </div>
          }
          className="lg:col-span-2"
        >
          <div className="grid grid-cols-3 gap-3 mb-3">
            <FinanceMetric label="In" value={fmtNum(totalIncome)} unit={cur} color="emerald" />
            <FinanceMetric label="Out" value={fmtNum(totalExpenses)} unit={cur} color="red" />
            <FinanceMetric label="Net" value={fmtNum(balance)} unit={cur} color={balance < 0 ? 'red' : 'emerald'} />
          </div>

          {/* Cumulative balance trend — primary chart */}
          <div className="border-t border-zinc-200/60 pt-3">
            <div className="flex items-center justify-between mb-1">
              <Label>Daily balance · cumulative</Label>
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                <span className="text-zinc-500">min</span>
                <span className={cls('tabular-nums', Math.min(...monthBalanceTrend) < 0 ? 'text-red-700' : 'text-zinc-700')}>
                  {fmtNum(Math.min(...monthBalanceTrend))}
                </span>
                <span className="text-zinc-300">·</span>
                <span className="text-zinc-500">max</span>
                <span className="text-emerald-700 tabular-nums">{fmtNum(Math.max(...monthBalanceTrend))}</span>
              </div>
            </div>
            <Sparkline data={monthBalanceTrend} color={balance < 0 ? '#ef4444' : '#10b981'} height={56} area={true} />
            <div className="flex items-center justify-between mt-1 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
              <span>Day 1</span>
              <span>Day {monthBalanceTrend.length}</span>
            </div>
          </div>

          {/* 7-day spending row */}
          <div className="border-t border-zinc-200/60 pt-3 mt-3">
            <div className="flex items-center justify-between mb-1">
              <Label>7-day spending</Label>
              <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                avg {fmtNum(last7Spend.reduce((s, n) => s + n, 0) / 7)} {cur}/day
              </span>
            </div>
            <Sparkline data={last7Spend} color="#ef4444" height={28} showDot={false} />
          </div>

          {/* Cap usage */}
          <div className="border-t border-zinc-200/60 pt-3 mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <Label>Cap usage</Label>
              <span className={cls(
                'font-mono text-[11px] tabular-nums',
                limitPct > 100 ? 'text-red-600' : limitPct > 80 ? 'text-amber-600' : 'text-zinc-800'
              )}>
                {limitPct}% · {fmtNum(totalExpenses)} / {fmtNum(limit)} {cur}
              </span>
            </div>
            <div className="h-2 bg-zinc-100 overflow-hidden relative">
              <div
                className={cls(
                  'h-full transition-all duration-500',
                  limitPct > 100 ? 'bg-red-500 shadow-[0_0_10px_#ef4444]' :
                  limitPct > 80 ? 'bg-amber-500 shadow-[0_0_10px_#f59e0b]' :
                  'bg-emerald-500 shadow-[0_0_10px_#10b981]'
                )}
                style={{ width: `${Math.min(limitPct, 100)}%` }}
              />
            </div>
          </div>
        </Panel>

        <Panel
          title="Activity.Feed"
          right={<span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 tabular-nums">{(data.activity || []).length}</span>}
        >
          <ActivityFeed log={data.activity} limit={8} />
        </Panel>
      </div>

      {/* Quick tasks */}
      <Panel title="Quick.Tasks" right={<Btn size="sm" onClick={() => setView('general')}>open<ArrowRight className="h-3 w-3" /></Btn>}>
        {data.generalTasks.filter((t) => !t.completed).length === 0 ? (
          <EmptyState icon={ListChecks} title="Inbox zero" subtitle="Nothing in your personal inbox." />
        ) : (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {data.generalTasks
              .filter((t) => !t.completed)
              .slice(0, 6)
              .map((t) => (
                <div key={t.id} className="flex items-center gap-2.5 border border-zinc-200 bg-zinc-50/40 px-3 py-2">
                  <Circle className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  <span className="text-[12px] text-zinc-800 truncate flex-1">{t.title}</span>
                  {t.priority && <Flame className="h-3 w-3 text-amber-600 shrink-0" />}
                </div>
              ))}
          </div>
        )}
      </Panel>
    </PageFrame>
  );
}

function KpiCard({ label, value, unit, detail, icon: Icon, accent = 'emerald', progress, spark, sparkColor, onClick }) {
  const accents = {
    emerald: 'border-emerald-500/30 hover:border-emerald-500/70 hover:shadow-[0_0_22px_-8px_#10b981] text-emerald-700',
    amber: 'border-amber-500/30 hover:border-amber-500/70 hover:shadow-[0_0_22px_-8px_#f59e0b] text-amber-700',
    cyan: 'border-cyan-500/30 hover:border-cyan-500/70 hover:shadow-[0_0_22px_-8px_#06b6d4] text-cyan-700',
    red: 'border-red-500/30 hover:border-red-500/70 hover:shadow-[0_0_22px_-8px_#ef4444] text-red-700',
  };
  const bars = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', cyan: 'bg-cyan-500', red: 'bg-red-500' };
  return (
    <button
      onClick={onClick}
      className={cls(
        'group relative text-left border bg-white/90 p-4 transition-all duration-200 shadow-[0_1px_2px_rgba(24,24,27,0.04)] overflow-hidden',
        accents[accent]
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <Label>{label}</Label>
        <Icon className="h-4 w-4 opacity-60 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-3xl font-bold tabular-nums text-zinc-900 leading-none">{value}</span>
        {unit && <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">{unit}</span>}
      </div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500 truncate">{detail}</div>
      {spark && spark.length > 0 && (
        <div className="mt-3 -mb-1">
          <Sparkline data={spark} color={sparkColor || '#10b981'} height={26} showDot={false} />
        </div>
      )}
      {typeof progress === 'number' && (
        <div className="absolute bottom-0 left-0 right-0 h-px bg-zinc-100">
          <div className={cls('h-full transition-all duration-500', bars[accent])} style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      )}
    </button>
  );
}

function FinanceMetric({ label, value, unit, color }) {
  const colors = {
    emerald: 'text-emerald-700 border-emerald-500/30 bg-emerald-500/[0.04]',
    red: 'text-red-700 border-red-500/30 bg-red-500/[0.04]',
    amber: 'text-amber-700 border-amber-500/30 bg-amber-500/[0.04]',
  };
  return (
    <div className={cls('border px-2.5 py-2', colors[color] || colors.emerald)}>
      <Label className="!text-current opacity-80">{label}</Label>
      <div className="font-mono text-lg font-bold tabular-nums leading-tight mt-0.5">{value}</div>
      <div className="font-mono text-[9px] uppercase tracking-wider opacity-60">{unit}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   NOVA WORKSPACE — categories, search, due dates, tags, priority
   ════════════════════════════════════════════════════════════════════════ */

function Nova({ data, setData, showToast }) {
  const [activeCat, setActiveCat] = useState(data.nova.categories[0]?.id || null);
  const [newCatName, setNewCatName] = useState('');
  const [showAddCat, setShowAddCat] = useState(false);
  const [taskInput, setTaskInput] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('created'); // created | priority | due | alpha
  const [filterPriority, setFilterPriority] = useState(false);
  const [filterDueToday, setFilterDueToday] = useState(false);

  const cats = data.nova.categories;
  const tasks = data.nova.tasks;
  const active = cats.find((c) => c.id === activeCat);
  const todayKey = dateKey(new Date());

  const visibleTasks = useMemo(() => {
    let arr = tasks.filter((t) => t.categoryId === activeCat);
    arr = arr.filter((t) => showCompleted || !t.completed);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      arr = arr.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        (t.notes || '').toLowerCase().includes(q) ||
        (t.tags || []).some((tag) => tag.toLowerCase().includes(q))
      );
    }
    if (filterPriority) arr = arr.filter((t) => t.priority);
    if (filterDueToday) arr = arr.filter((t) => t.dueDate === todayKey || (t.dueDate && t.dueDate < todayKey));

    arr.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (sortBy === 'priority') {
        if (a.priority !== b.priority) return a.priority ? -1 : 1;
      }
      if (sortBy === 'due') {
        const ad = a.dueDate || '9999-99-99';
        const bd = b.dueDate || '9999-99-99';
        if (ad !== bd) return ad < bd ? -1 : 1;
      }
      if (sortBy === 'alpha') return a.title.localeCompare(b.title);
      // default: created (newest first)
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    return arr;
  }, [tasks, activeCat, showCompleted, search, filterPriority, filterDueToday, sortBy, todayKey]);

  const addCat = () => {
    const name = newCatName.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) + '-' + uid().slice(0, 4);
    setData((d) => ({ ...d, nova: { ...d.nova, categories: [...d.nova.categories, { id, name, color: 'emerald' }] } }));
    setActiveCat(id);
    setNewCatName('');
    setShowAddCat(false);
  };

  const delCat = (id) => {
    if (!confirm(`Delete category and all its tasks?`)) return;
    setData((d) => ({
      ...d,
      nova: {
        categories: d.nova.categories.filter((c) => c.id !== id),
        tasks: d.nova.tasks.filter((t) => t.categoryId !== id),
      },
    }));
    if (activeCat === id) setActiveCat(cats.find((c) => c.id !== id)?.id || null);
  };

  const addTask = () => {
    const title = taskInput.trim();
    if (!title || !activeCat) return;
    // Parse `!` prefix for priority, `#tag` for tags
    let workingTitle = title;
    let priority = false;
    if (workingTitle.startsWith('!')) {
      priority = true;
      workingTitle = workingTitle.slice(1).trim();
    }
    const tags = [];
    workingTitle = workingTitle.replace(/#(\S+)/g, (_, tag) => { tags.push(tag); return ''; }).trim();

    const newTask = {
      id: uid(),
      title: workingTitle,
      categoryId: activeCat,
      completed: false,
      priority,
      createdAt: new Date().toISOString(),
      notes: '',
      tags,
    };
    setData((d) => ({ ...d, nova: { ...d.nova, tasks: [newTask, ...d.nova.tasks] } }));
    logActivity(setData, 'task_added', `Nova: "${workingTitle}"`);
    setTaskInput('');
  };

  const updateTask = (id, patch) => {
    setData((d) => ({
      ...d,
      nova: {
        ...d.nova,
        tasks: d.nova.tasks.map((t) => {
          if (t.id !== id) return t;
          const next = { ...t, ...patch };
          if (patch.completed && !t.completed) next.completedAt = new Date().toISOString();
          if (patch.completed === false) delete next.completedAt;
          return next;
        }),
      },
    }));
    if (patch.completed) {
      const t = data.nova.tasks.find((x) => x.id === id);
      if (t) logActivity(setData, 'task_done', `Done: "${t.title}"`);
    }
  };

  const delTask = (id) => {
    const t = data.nova.tasks.find((x) => x.id === id);
    setData((d) => ({ ...d, nova: { ...d.nova, tasks: d.nova.tasks.filter((x) => x.id !== id) } }));
    if (t) logActivity(setData, 'task_deleted', `Removed: "${t.title}"`);
  };

  const openCount = (catId) => tasks.filter((t) => t.categoryId === catId && !t.completed).length;
  const overdueCount = (catId) => tasks.filter((t) => t.categoryId === catId && !t.completed && t.dueDate && t.dueDate < todayKey).length;

  return (
    <PageFrame
      index={2}
      title="Nova Workspace"
      subtitle="Categorized task system with priority, due dates, and tags. Use !task for priority, #tag for tags."
      actions={
        <>
          <Btn onClick={() => setShowCompleted((s) => !s)}>
            <Eye className="h-3 w-3" />
            {showCompleted ? 'Hide' : 'Show'} done
          </Btn>
        </>
      }
    >
      <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
        {/* Sidebar — categories */}
        <aside className="border border-zinc-200 bg-white/90 p-3 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
          <div className="flex items-center justify-between mb-3">
            <Label>Categories</Label>
            <button
              onClick={() => setShowAddCat((s) => !s)}
              className="h-5 w-5 border border-zinc-200 text-zinc-500 hover:border-emerald-500 hover:text-emerald-700 flex items-center justify-center"
              title="Add category"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {showAddCat && (
            <div className="mb-3 flex items-center gap-1.5">
              <Input
                autoFocus
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addCat(); if (e.key === 'Escape') setShowAddCat(false); }}
                placeholder="Category name"
                className="flex-1"
              />
              <button onClick={addCat} className="h-7 w-7 border border-emerald-500/60 text-emerald-700 hover:bg-emerald-500/10 flex items-center justify-center">
                <Check className="h-3 w-3" />
              </button>
            </div>
          )}

          <div className="space-y-1">
            {cats.map((c) => {
              const isActive = c.id === activeCat;
              const count = openCount(c.id);
              const overdue = overdueCount(c.id);
              return (
                <div key={c.id} className="group flex items-center">
                  <button
                    onClick={() => setActiveCat(c.id)}
                    className={cls(
                      'flex-1 flex items-center justify-between gap-2 px-2.5 py-1.5 border transition-all',
                      isActive
                        ? 'border-emerald-500/40 bg-emerald-500/[0.04] text-emerald-800'
                        : 'border-transparent text-zinc-700 hover:border-zinc-200 hover:bg-white hover:text-zinc-900'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cls(
                        'h-1.5 w-1.5 rounded-full shrink-0',
                        isActive ? 'bg-emerald-500 shadow-[0_0_4px_#34d399]' : 'bg-zinc-300'
                      )} />
                      <span className="text-[13px] truncate font-medium">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {overdue > 0 && (
                        <span className="font-mono text-[9px] tabular-nums bg-red-500/15 text-red-700 px-1 border border-red-500/30">
                          {overdue}
                        </span>
                      )}
                      <span className="font-mono text-[10px] tabular-nums text-zinc-500">{count}</span>
                    </div>
                  </button>
                  <button
                    onClick={() => delCat(c.id)}
                    className="opacity-0 group-hover:opacity-100 ml-1 p-1 text-zinc-400 hover:text-red-600"
                    title="Delete category"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Stats */}
          <div className="mt-4 pt-3 border-t border-zinc-200/60 space-y-1">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <span>Total open</span>
              <span className="tabular-nums text-zinc-800">{tasks.filter((t) => !t.completed).length}</span>
            </div>
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <span>Priority</span>
              <span className="tabular-nums text-amber-700">{tasks.filter((t) => !t.completed && t.priority).length}</span>
            </div>
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <span>Overdue</span>
              <span className="tabular-nums text-red-700">{tasks.filter((t) => !t.completed && t.dueDate && t.dueDate < todayKey).length}</span>
            </div>
          </div>
        </aside>

        {/* Main — tasks */}
        <main className="border border-zinc-200 bg-white/90 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
          {/* Header bar */}
          <div className="border-b border-zinc-200 px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <NeonDot on={visibleTasks.filter((t) => !t.completed).length > 0} />
                <h2 className="font-mono text-sm font-bold uppercase tracking-[0.16em] text-zinc-900 truncate">
                  {active?.name || 'Select category'}
                </h2>
                <span className="font-mono text-[10px] tabular-nums text-zinc-500">
                  {visibleTasks.filter((t) => !t.completed).length} open
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <SortDropdown value={sortBy} onChange={setSortBy} />
              </div>
            </div>

            {/* Search + filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-1 border border-zinc-200 bg-zinc-50 px-3 py-1.5 focus-within:border-emerald-500/60 min-w-[200px]">
                <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tasks, notes, tags…"
                  className="flex-1 bg-transparent text-[12px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="text-zinc-400 hover:text-zinc-900">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <FilterChip active={filterPriority} onClick={() => setFilterPriority((s) => !s)} icon={Flame}>Priority</FilterChip>
              <FilterChip active={filterDueToday} onClick={() => setFilterDueToday((s) => !s)} icon={Calendar}>Due today/overdue</FilterChip>
            </div>
          </div>

          {/* Add task */}
          {active && (
            <div className="border-b border-zinc-200 px-4 py-3 bg-zinc-50/40">
              <div className="flex items-center gap-2 border border-zinc-200 bg-white px-3 py-2 focus-within:border-emerald-500/60 focus-within:shadow-[0_0_0_1px_rgba(16,185,129,0.2)] transition-all">
                <Plus className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <input
                  value={taskInput}
                  onChange={(e) => setTaskInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTask()}
                  placeholder={`Add to ${active.name}…  (! = priority,  #tag = add tag)`}
                  className="flex-1 bg-transparent text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
                />
                <KbdKey>↵</KbdKey>
              </div>
            </div>
          )}

          {/* Task list */}
          <div className="divide-y divide-zinc-200/60">
            {!active && <EmptyState icon={Workflow} title="No category selected" subtitle="Pick or add one from the sidebar." />}
            {active && visibleTasks.length === 0 && (
              <EmptyState
                icon={CheckCircle2}
                title={search || filterPriority || filterDueToday ? 'No matches' : 'No tasks here yet'}
                subtitle={search || filterPriority || filterDueToday ? 'Adjust filters or search query.' : 'Add one above to get rolling.'}
              />
            )}
            {visibleTasks.map((t) => (
              <NovaTaskRow
                key={t.id}
                task={t}
                onUpdate={(patch) => updateTask(t.id, patch)}
                onDelete={() => delTask(t.id)}
                todayKey={todayKey}
              />
            ))}
          </div>
        </main>
      </div>
    </PageFrame>
  );
}

function SortDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const options = [
    { v: 'created', label: 'Newest first' },
    { v: 'priority', label: 'Priority first' },
    { v: 'due', label: 'Due date' },
    { v: 'alpha', label: 'Alphabetical' },
  ];
  const curr = options.find((o) => o.v === value);
  useEffect(() => {
    if (!open) return;
    const h = () => setOpen(false);
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, [open]);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <Btn size="sm" onClick={() => setOpen((s) => !s)}>
        <ArrowUpDown className="h-3 w-3" />
        <span>{curr?.label || 'Sort'}</span>
      </Btn>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 bg-white border border-zinc-200 shadow-[0_8px_24px_-6px_rgba(24,24,27,0.12)] py-1 min-w-[160px]">
          {options.map((o) => (
            <button
              key={o.v}
              onClick={() => { onChange(o.v); setOpen(false); }}
              className={cls(
                'w-full text-left px-3 py-1.5 text-[12px] hover:bg-zinc-50 transition-colors',
                value === o.v ? 'text-emerald-700 font-bold' : 'text-zinc-700'
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className={cls(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 border font-mono text-[10px] uppercase tracking-[0.12em] transition-all',
        active
          ? 'border-emerald-500/60 bg-emerald-500/[0.06] text-emerald-700'
          : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'
      )}
    >
      <Icon className="h-3 w-3" />
      {children}
    </button>
  );
}

function NovaTaskRow({ task, onUpdate, onDelete, todayKey }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [expand, setExpand] = useState(false);
  const [notes, setNotes] = useState(task.notes || '');
  const [tagInput, setTagInput] = useState('');

  const save = () => {
    if (title.trim()) onUpdate({ title: title.trim() });
    else setTitle(task.title);
    setEditing(false);
  };

  const saveNotes = () => {
    if (notes !== task.notes) onUpdate({ notes });
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t) return;
    const tags = [...(task.tags || []), t];
    onUpdate({ tags });
    setTagInput('');
  };

  const removeTag = (i) => {
    onUpdate({ tags: (task.tags || []).filter((_, idx) => idx !== i) });
  };

  const setDue = (k) => onUpdate({ dueDate: k });

  const overdue = task.dueDate && task.dueDate < todayKey && !task.completed;
  const dueToday = task.dueDate === todayKey;

  return (
    <div
      className={cls(
        'group transition-all',
        task.completed && 'opacity-50',
        task.priority && !task.completed && 'bg-amber-50/40',
        overdue && 'bg-red-50/40'
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Checkbox */}
        <button
          onClick={() => onUpdate({ completed: !task.completed })}
          className={cls(
            'shrink-0 h-4 w-4 border flex items-center justify-center transition-all',
            task.completed ? 'border-emerald-500 bg-emerald-500/20' : 'border-zinc-300 hover:border-emerald-500'
          )}
        >
          {task.completed && <Check className="h-3 w-3 text-emerald-700" strokeWidth={3} />}
        </button>

        {/* Title */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setTitle(task.title); setEditing(false); } }}
              className="w-full bg-transparent text-[13px] text-zinc-900 focus:outline-none border-b border-emerald-500/60"
            />
          ) : (
            <div
              onDoubleClick={() => setEditing(true)}
              className={cls(
                'text-[13px] cursor-text leading-snug truncate',
                task.completed ? 'text-zinc-400 line-through' : 'text-zinc-900'
              )}
            >
              {task.title}
            </div>
          )}
          {/* Tags + due inline */}
          {((task.tags && task.tags.length > 0) || task.dueDate) && (
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {task.dueDate && (
                <span className={cls(
                  'inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border',
                  overdue ? 'border-red-500/40 text-red-700 bg-red-500/[0.06]' :
                  dueToday ? 'border-amber-500/40 text-amber-700 bg-amber-500/[0.06]' :
                  'border-zinc-200 text-zinc-500'
                )}>
                  <Calendar className="h-2.5 w-2.5" />
                  {task.dueDate === todayKey ? 'today' :
                    overdue ? `overdue ${Math.abs(daysBetween(todayKey, task.dueDate))}d` :
                    task.dueDate.slice(5)}
                </span>
              )}
              {(task.tags || []).map((tag, i) => (
                <span key={i} className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-cyan-500/30 text-cyan-700 bg-cyan-500/[0.04]">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onUpdate({ priority: !task.priority })}
            title={task.priority ? 'Remove priority' : 'Mark priority'}
            className={cls(
              'h-6 px-1.5 flex items-center gap-1 font-mono text-[10px] tracking-wider border transition-all',
              task.priority
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-700 shadow-[0_0_8px_-2px_#f59e0b]'
                : 'border-transparent text-zinc-300 hover:text-amber-600 hover:border-amber-500/30'
            )}
          >
            !!!
          </button>
          <button
            onClick={() => setExpand((s) => !s)}
            className="opacity-0 group-hover:opacity-100 h-6 w-6 text-zinc-400 hover:text-emerald-700 flex items-center justify-center"
            title="Details"
          >
            {expand ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 h-6 w-6 text-zinc-400 hover:text-red-600 flex items-center justify-center"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expand && (
        <div className="border-t border-zinc-200/60 bg-zinc-50/40 px-3 py-2.5 space-y-2">
          {/* Due date quick-picker */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Label>Due</Label>
            <DueChip label="today" onClick={() => setDue(todayKey)} active={task.dueDate === todayKey} />
            <DueChip label="tomorrow" onClick={() => {
              const d = new Date(); d.setDate(d.getDate() + 1); setDue(dateKey(d));
            }} active={task.dueDate === (() => { const d = new Date(); d.setDate(d.getDate() + 1); return dateKey(d); })()} />
            <DueChip label="this week" onClick={() => {
              const d = new Date(); d.setDate(d.getDate() + (7 - d.getDay()));
              setDue(dateKey(d));
            }} />
            <input
              type="date"
              value={task.dueDate || ''}
              onChange={(e) => setDue(e.target.value)}
              className="bg-white border border-zinc-200 px-2 py-1 font-mono text-[10px] text-zinc-700 focus:outline-none focus:border-emerald-500/60"
            />
            {task.dueDate && (
              <button onClick={() => onUpdate({ dueDate: null })} className="font-mono text-[10px] text-zinc-400 hover:text-red-600 px-1">clear</button>
            )}
          </div>

          {/* Tag input */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Label>Tags</Label>
            {(task.tags || []).map((tag, i) => (
              <span key={i} className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-cyan-500/30 text-cyan-700 bg-cyan-500/[0.04] flex items-center gap-1">
                #{tag}
                <button onClick={() => removeTag(i)} className="hover:text-red-600"><X className="h-2.5 w-2.5" /></button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTag(); }}
              placeholder="add tag"
              className="bg-white border border-zinc-200 px-2 py-1 font-mono text-[10px] text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500/60 w-24"
            />
          </div>

          {/* Notes */}
          <div>
            <Label>Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Free-form notes…"
              rows={3}
              className="mt-1 w-full bg-white border border-zinc-200 px-2.5 py-1.5 font-mono text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500/60 resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DueChip({ label, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={cls(
        'font-mono text-[10px] uppercase tracking-wider px-2 py-1 border transition-all',
        active
          ? 'border-emerald-500/60 bg-emerald-500/[0.08] text-emerald-700'
          : 'border-zinc-200 text-zinc-500 hover:border-emerald-500/40 hover:text-emerald-700'
      )}
    >
      {label}
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   JOBS / HUNT — Kanban with rich card metadata
   ════════════════════════════════════════════════════════════════════════ */

function Jobs({ data, setData, showToast }) {
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [addingTo, setAddingTo] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [search, setSearch] = useState('');

  const byCol = useMemo(() => {
    const m = {};
    data.jobs.columns.forEach((c) => m[c.id] = []);
    data.jobs.cards.forEach((c) => { (m[c.columnId] = m[c.columnId] || []).push(c); });
    return m;
  }, [data.jobs]);

  const filteredByCol = useMemo(() => {
    if (!search.trim()) return byCol;
    const q = search.toLowerCase().trim();
    const filtered = {};
    Object.entries(byCol).forEach(([k, arr]) => {
      filtered[k] = arr.filter((c) =>
        (c.company || '').toLowerCase().includes(q) ||
        (c.role || '').toLowerCase().includes(q) ||
        (c.notes || '').toLowerCase().includes(q) ||
        (c.location || '').toLowerCase().includes(q)
      );
    });
    return filtered;
  }, [byCol, search]);

  const addCard = (companyName, columnId) => {
    const name = companyName.trim();
    if (!name) return;
    const newCard = {
      id: uid(),
      columnId,
      company: name,
      role: '',
      notes: '',
      salary: '',
      url: '',
      location: '',
      appliedAt: '',
      nextFollowUp: '',
      createdAt: new Date().toISOString(),
    };
    setData((d) => ({ ...d, jobs: { ...d.jobs, cards: [...d.jobs.cards, newCard] } }));
    logActivity(setData, 'job_added', `Hunt: ${name}`);
    setAddingTo(null);
  };

  const updateCard = (id, patch) => {
    setData((d) => ({ ...d, jobs: { ...d.jobs, cards: d.jobs.cards.map((c) => c.id === id ? { ...c, ...patch } : c) } }));
  };

  const moveCard = (id, columnId) => {
    const card = data.jobs.cards.find((c) => c.id === id);
    if (!card || card.columnId === columnId) return;
    const targetCol = data.jobs.columns.find((c) => c.id === columnId);
    setData((d) => ({ ...d, jobs: { ...d.jobs, cards: d.jobs.cards.map((c) => c.id === id ? { ...c, columnId } : c) } }));
    if (card && targetCol) logActivity(setData, 'job_moved', `${card.company} → ${targetCol.name}`);
  };

  const delCard = (id) => {
    setData((d) => ({ ...d, jobs: { ...d.jobs, cards: d.jobs.cards.filter((c) => c.id !== id) } }));
  };

  // Stats: conversion rate per column
  const total = data.jobs.cards.length;
  const interviewCount = (byCol.interviewing || []).length;
  const offerCount = (byCol.offer || []).length;
  const responseRate = total > 0 ? Math.round((((byCol.contacted || []).length + interviewCount + offerCount) / total) * 100) : 0;
  const offerRate = total > 0 ? Math.round((offerCount / total) * 100) : 0;

  // Follow-ups due
  const todayKey = dateKey(new Date());
  const followUpsDue = data.jobs.cards.filter((c) => c.nextFollowUp && c.nextFollowUp <= todayKey);

  return (
    <PageFrame
      index={3}
      title="Hunt Pipeline"
      subtitle="Active job applications with salary, URL, follow-up tracking. Drag cards or use arrows to move stages."
      actions={
        <>
          {followUpsDue.length > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 border border-amber-500/40 bg-amber-500/[0.06] text-amber-700 flex items-center gap-1.5">
              <Clock className="h-3 w-3" /> {followUpsDue.length} follow-up{followUpsDue.length !== 1 ? 's' : ''} due
            </span>
          )}
        </>
      }
    >
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <StatBox label="Total Apps" value={total} icon={Briefcase} />
        <StatBox label="Response Rate" value={responseRate} unit="%" icon={ActivityIcon} color="cyan" />
        <StatBox label="Interviews" value={interviewCount} icon={Calendar} color="amber" />
        <StatBox label="Offers" value={offerCount} icon={Trophy} color="emerald" />
      </div>

      {/* Search */}
      <div className="mb-3 flex items-center gap-2 border border-zinc-200 bg-white px-3 py-1.5 focus-within:border-emerald-500/60 max-w-md">
        <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, role, location…"
          className="flex-1 bg-transparent text-[12px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
        />
        {search && <button onClick={() => setSearch('')} className="text-zinc-400 hover:text-zinc-900"><X className="h-3.5 w-3.5" /></button>}
      </div>

      {/* Kanban */}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        {data.jobs.columns.map((col, colIdx) => {
          const cards = filteredByCol[col.id] || [];
          const isDragOver = dragOver === col.id;
          return (
            <div
              key={col.id}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('cardId');
                if (id) moveCard(id, col.id);
                setDragOver(null);
                setDragging(null);
              }}
              className={cls(
                'flex flex-col border bg-white/90 transition-all min-h-[400px] shadow-[0_1px_2px_rgba(24,24,27,0.04)]',
                isDragOver ? 'border-emerald-500 bg-emerald-500/[0.04] shadow-[0_0_30px_-12px_#10b981]' : 'border-zinc-200'
              )}
            >
              {/* Column header */}
              <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5 bg-zinc-50">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] tabular-nums text-zinc-400">{pad(colIdx + 1)}</span>
                  <NeonDot on={cards.length > 0} />
                  <h3 className="font-mono text-[12px] uppercase tracking-[0.18em] text-zinc-900 font-bold">{col.name}</h3>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-zinc-500 px-1.5 border border-zinc-200">{cards.length}</span>
              </div>

              {/* Cards */}
              <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[60vh]">
                {cards.map((card) => (
                  <JobCard
                    key={card.id}
                    card={card}
                    columns={data.jobs.columns}
                    isDragging={dragging === card.id}
                    onDragStart={() => setDragging(card.id)}
                    onDragEnd={() => setDragging(null)}
                    onUpdate={(p) => updateCard(card.id, p)}
                    onDelete={() => delCard(card.id)}
                    onMove={(toId) => moveCard(card.id, toId)}
                    expanded={!!expanded[card.id]}
                    setExpanded={(v) => setExpanded((e) => ({ ...e, [card.id]: v }))}
                    todayKey={todayKey}
                  />
                ))}

                {/* Add card */}
                {addingTo === col.id ? (
                  <AddCardForm onAdd={(name) => addCard(name, col.id)} onCancel={() => setAddingTo(null)} />
                ) : (
                  <button
                    onClick={() => setAddingTo(col.id)}
                    className="w-full font-mono text-[11px] uppercase tracking-wider text-zinc-400 border border-dashed border-zinc-200 px-3 py-2 hover:border-emerald-500/40 hover:text-emerald-700 hover:bg-emerald-500/[0.02] transition-all flex items-center justify-center gap-1.5"
                  >
                    <Plus className="h-3 w-3" />
                    Add card
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </PageFrame>
  );
}

function StatBox({ label, value, unit, icon: Icon, color = 'zinc' }) {
  const colors = {
    zinc: 'border-zinc-200 text-zinc-700',
    emerald: 'border-emerald-500/30 text-emerald-700',
    amber: 'border-amber-500/30 text-amber-700',
    cyan: 'border-cyan-500/30 text-cyan-700',
  };
  return (
    <div className={cls('border bg-white/90 p-3 shadow-[0_1px_2px_rgba(24,24,27,0.04)]', colors[color])}>
      <div className="flex items-center justify-between mb-1">
        <Label className="!text-current opacity-70">{label}</Label>
        <Icon className="h-3.5 w-3.5 opacity-60" />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-bold tabular-nums text-zinc-900">{value}</span>
        {unit && <span className="font-mono text-xs uppercase tracking-wider opacity-60">{unit}</span>}
      </div>
    </div>
  );
}

function AddCardForm({ onAdd, onCancel }) {
  const [name, setName] = useState('');
  return (
    <div className="border border-emerald-500/40 bg-emerald-500/[0.04] p-2.5 space-y-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onAdd(name); if (e.key === 'Escape') onCancel(); }}
        placeholder="Company name"
        className="w-full bg-white border border-zinc-200 px-2.5 py-1.5 font-mono text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500/60"
      />
      <div className="flex items-center gap-1">
        <Btn size="sm" variant="primary" onClick={() => onAdd(name)}>Add</Btn>
        <Btn size="sm" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

function JobCard({ card, columns, isDragging, onDragStart, onDragEnd, onUpdate, onDelete, onMove, expanded, setExpanded, todayKey }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});

  const startEdit = () => {
    setDraft({
      company: card.company,
      role: card.role || '',
      salary: card.salary || '',
      url: card.url || '',
      location: card.location || '',
      appliedAt: card.appliedAt || '',
      nextFollowUp: card.nextFollowUp || '',
      notes: card.notes || '',
    });
    setEditing(true);
  };

  const save = () => {
    onUpdate({ ...draft, company: draft.company.trim() || card.company });
    setEditing(false);
  };

  const colIdx = columns.findIndex((c) => c.id === card.columnId);
  const prevCol = columns[colIdx - 1];
  const nextCol = columns[colIdx + 1];

  // Days since applied
  const daysApplied = card.appliedAt ? daysBetween(card.appliedAt, new Date()) : null;
  const followUpDue = card.nextFollowUp && card.nextFollowUp <= todayKey;

  return (
    <div
      draggable={!editing}
      onDragStart={(e) => { e.dataTransfer.setData('cardId', card.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      className={cls(
        'group border bg-white p-2.5 transition-all',
        isDragging ? 'opacity-50' : 'border-zinc-200 hover:border-zinc-400 hover:shadow-[0_2px_8px_-2px_rgba(24,24,27,0.08)]',
        followUpDue && !editing && 'border-amber-500/40 bg-amber-50/40'
      )}
    >
      {editing ? (
        <div className="space-y-1.5">
          <input
            autoFocus
            value={draft.company}
            onChange={(e) => setDraft({ ...draft, company: e.target.value })}
            placeholder="Company"
            className="w-full bg-zinc-50 border border-zinc-200 px-2 py-1 font-mono text-[12px] text-zinc-900 font-bold focus:outline-none focus:border-emerald-500/60"
          />
          <input
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value })}
            placeholder="Role / title"
            className="w-full bg-zinc-50 border border-zinc-200 px-2 py-1 font-mono text-[11px] text-zinc-700 focus:outline-none focus:border-emerald-500/60"
          />
          <div className="grid grid-cols-2 gap-1">
            <input
              value={draft.salary}
              onChange={(e) => setDraft({ ...draft, salary: e.target.value })}
              placeholder="Salary"
              className="bg-zinc-50 border border-zinc-200 px-2 py-1 font-mono text-[11px] text-zinc-700 focus:outline-none focus:border-emerald-500/60"
            />
            <input
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              placeholder="Location"
              className="bg-zinc-50 border border-zinc-200 px-2 py-1 font-mono text-[11px] text-zinc-700 focus:outline-none focus:border-emerald-500/60"
            />
          </div>
          <input
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder="https://job-url"
            className="w-full bg-zinc-50 border border-zinc-200 px-2 py-1 font-mono text-[11px] text-zinc-700 focus:outline-none focus:border-emerald-500/60"
          />
          <div className="grid grid-cols-2 gap-1">
            <label className="flex flex-col gap-0.5">
              <Label>Applied</Label>
              <input
                type="date"
                value={draft.appliedAt}
                onChange={(e) => setDraft({ ...draft, appliedAt: e.target.value })}
                className="bg-zinc-50 border border-zinc-200 px-2 py-1 font-mono text-[10px] text-zinc-700 focus:outline-none focus:border-emerald-500/60"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <Label>Follow-up</Label>
              <input
                type="date"
                value={draft.nextFollowUp}
                onChange={(e) => setDraft({ ...draft, nextFollowUp: e.target.value })}
                className="bg-zinc-50 border border-zinc-200 px-2 py-1 font-mono text-[10px] text-zinc-700 focus:outline-none focus:border-emerald-500/60"
              />
            </label>
          </div>
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Notes / contact / recruiter…"
            rows={2}
            className="w-full bg-zinc-50 border border-zinc-200 px-2 py-1 font-mono text-[11px] text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500/60 resize-none"
          />
          <div className="flex items-center justify-end gap-1 pt-1">
            <Btn size="sm" onClick={() => setEditing(false)}>Cancel</Btn>
            <Btn size="sm" variant="primary" onClick={save}>Save</Btn>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <GripVertical className="h-3 w-3 text-zinc-300 group-hover:text-zinc-400 cursor-grab shrink-0" />
                <h4 className="font-mono text-[13px] font-bold text-zinc-900 truncate">{card.company}</h4>
              </div>
              {card.role && <div className="text-[11px] text-zinc-600 mt-0.5 ml-4 truncate">{card.role}</div>}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={startEdit}
                className="opacity-0 group-hover:opacity-100 h-5 w-5 text-zinc-400 hover:text-emerald-700 flex items-center justify-center"
                title="Edit"
              >
                <Edit3 className="h-3 w-3" />
              </button>
              <button
                onClick={() => setExpanded(!expanded)}
                className="h-5 w-5 text-zinc-400 hover:text-zinc-700 flex items-center justify-center"
                title="Toggle details"
              >
                {expanded ? <ChevronUp className="h-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </div>
          </div>

          {/* Quick badges */}
          {(card.salary || card.location || daysApplied !== null) && (
            <div className="flex items-center gap-1.5 mt-1.5 ml-4 flex-wrap">
              {card.salary && (
                <span className="font-mono text-[10px] text-emerald-700 bg-emerald-500/[0.06] border border-emerald-500/30 px-1.5">
                  {card.salary}
                </span>
              )}
              {card.location && (
                <span className="font-mono text-[10px] text-zinc-600 flex items-center gap-0.5">
                  <MapPin className="h-2.5 w-2.5" />
                  {card.location}
                </span>
              )}
              {daysApplied !== null && (
                <span className="font-mono text-[10px] text-zinc-500">
                  {daysApplied}d ago
                </span>
              )}
              {followUpDue && (
                <span className="font-mono text-[10px] text-amber-700 bg-amber-500/[0.06] border border-amber-500/30 px-1.5 flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" /> follow up
                </span>
              )}
            </div>
          )}

          {/* Expanded details */}
          {expanded && (
            <div className="mt-2 pt-2 border-t border-zinc-200/60 space-y-1.5 ml-4">
              {card.url && (
                <a href={card.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-cyan-700 hover:text-cyan-800 truncate">
                  <LinkIcon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{card.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
                </a>
              )}
              {card.appliedAt && (
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  Applied: <span className="text-zinc-700">{card.appliedAt}</span>
                </div>
              )}
              {card.nextFollowUp && (
                <div className={cls(
                  'font-mono text-[10px] uppercase tracking-wider',
                  followUpDue ? 'text-amber-700' : 'text-zinc-500'
                )}>
                  Follow-up: <span className={followUpDue ? 'text-amber-800 font-bold' : 'text-zinc-700'}>{card.nextFollowUp}</span>
                </div>
              )}
              {card.notes && (
                <div className="text-[11px] text-zinc-600 whitespace-pre-wrap leading-snug">{card.notes}</div>
              )}
            </div>
          )}

          {/* Column move arrows */}
          <div className="flex items-center justify-between gap-1 mt-2 ml-4">
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => prevCol && onMove(prevCol.id)}
                disabled={!prevCol}
                className="h-5 px-1 font-mono text-[9px] uppercase tracking-wider text-zinc-400 hover:text-emerald-700 disabled:opacity-30 disabled:hover:text-zinc-400 flex items-center gap-0.5"
              >
                <ChevronLeft className="h-3 w-3" />
                {prevCol?.name}
              </button>
              {nextCol && (
                <button
                  onClick={() => onMove(nextCol.id)}
                  className="h-5 px-1 font-mono text-[9px] uppercase tracking-wider text-zinc-400 hover:text-emerald-700 flex items-center gap-0.5"
                >
                  {nextCol.name}
                  <ChevronRight className="h-3 w-3" />
                </button>
              )}
            </div>
            <button
              onClick={onDelete}
              className="opacity-0 group-hover:opacity-100 h-5 w-5 text-zinc-400 hover:text-red-600 flex items-center justify-center"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   HABITS — Week / Month / Year views, per-habit stats and targets
   ════════════════════════════════════════════════════════════════════════ */

function Habits({ data, setData, showToast }) {
  const [viewMode, setViewMode] = useState('week'); // week | month | year
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [editingHabit, setEditingHabit] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);
  const [newHabitName, setNewHabitName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const today = new Date();
  const baseDate = new Date(today);
  baseDate.setDate(baseDate.getDate() + weekOffset * 7);

  const currentWeekKey = getWeekKey(baseDate);
  const weekDates = getWeekDates(baseDate);
  const todayIdx = isSameDay(baseDate, today) ? (today.getDay() === 0 ? 6 : today.getDay() - 1) : -1;

  const habits = data.habits.list;
  const weeks = data.habits.weeks;

  const toggleCell = (habitId, dayKey) => {
    setData((d) => {
      const wk = d.habits.weeks[currentWeekKey] || {};
      const h = wk[habitId] || {};
      const next = !h[dayKey];
      const newWeek = { ...wk, [habitId]: { ...h, [dayKey]: next } };
      return { ...d, habits: { ...d.habits, weeks: { ...d.habits.weeks, [currentWeekKey]: newWeek } } };
    });
    if (!(weeks[currentWeekKey]?.[habitId]?.[dayKey])) {
      const habit = habits.find((h) => h.id === habitId);
      if (habit) logActivity(setData, 'habit_check', `${habit.emoji || '✓'} ${habit.name}`);
    }
  };

  const addHabit = () => {
    const name = newHabitName.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) + '-' + uid().slice(0, 4);
    setData((d) => ({ ...d, habits: { ...d.habits, list: [...d.habits.list, { id, name, emoji: '🎯', target: 7 }] } }));
    setNewHabitName('');
    setShowAddForm(false);
  };

  const updateHabit = (id, patch) => {
    setData((d) => ({
      ...d,
      habits: { ...d.habits, list: d.habits.list.map((h) => h.id === id ? { ...h, ...patch } : h) },
    }));
  };

  const delHabit = (id) => {
    if (!confirm('Delete this habit and all its records?')) return;
    setData((d) => ({
      ...d,
      habits: {
        ...d.habits,
        list: d.habits.list.filter((h) => h.id !== id),
        weeks: Object.fromEntries(Object.entries(d.habits.weeks).map(([wk, byH]) => {
          const next = { ...byH };
          delete next[id];
          return [wk, next];
        })),
      },
    }));
  };

  // Helpers
  const getWeekData = (wk, habitId) => weeks[wk]?.[habitId] || {};

  const weekDoneCount = (habitId, wk = currentWeekKey) => {
    const w = getWeekData(wk, habitId);
    return DAY_KEYS.filter((d) => w[d]).length;
  };

  // Calculate current streak (consecutive days from today going back)
  const calcStreak = (habitId) => {
    let streak = 0;
    const cursor = new Date(today);
    // If today not yet done, start from yesterday (lenient)
    const todayDayKey = DAY_KEYS[today.getDay() === 0 ? 6 : today.getDay() - 1];
    const todayWkKey = getWeekKey(today);
    if (!getWeekData(todayWkKey, habitId)[todayDayKey]) {
      cursor.setDate(cursor.getDate() - 1);
    }
    for (let i = 0; i < 365; i++) {
      const wk = getWeekKey(cursor);
      const dk = DAY_KEYS[cursor.getDay() === 0 ? 6 : cursor.getDay() - 1];
      if (getWeekData(wk, habitId)[dk]) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else break;
    }
    return streak;
  };

  // Longest streak ever for a habit
  const calcLongestStreak = (habitId) => {
    const allDays = [];
    Object.entries(weeks).forEach(([wk, byH]) => {
      const habitWeek = byH[habitId];
      if (!habitWeek) return;
      const [y, m, d] = wk.split('-').map(Number);
      const start = new Date(y, m - 1, d);
      DAY_KEYS.forEach((dk, di) => {
        if (habitWeek[dk]) {
          const day = new Date(start);
          day.setDate(day.getDate() + di);
          allDays.push(dateKey(day));
        }
      });
    });
    allDays.sort();
    let longest = 0;
    let current = 0;
    let prev = null;
    for (const d of allDays) {
      if (!prev) { current = 1; }
      else {
        const diff = daysBetween(prev, d);
        if (diff === 1) current++;
        else current = 1;
      }
      longest = Math.max(longest, current);
      prev = d;
    }
    return longest;
  };

  // Total cells filled
  const calcTotalDays = (habitId) => {
    let count = 0;
    Object.values(weeks).forEach((byH) => {
      const habitWeek = byH[habitId];
      if (!habitWeek) return;
      DAY_KEYS.forEach((dk) => { if (habitWeek[dk]) count++; });
    });
    return count;
  };

  // Best day of week (most-completed day)
  const bestDayOfWeek = (habitId) => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    Object.values(weeks).forEach((byH) => {
      const habitWeek = byH[habitId];
      if (!habitWeek) return;
      DAY_KEYS.forEach((dk, i) => { if (habitWeek[dk]) counts[i]++; });
    });
    const maxIdx = counts.indexOf(Math.max(...counts));
    return Math.max(...counts) > 0 ? DAYS[maxIdx] : '—';
  };

  // Year-day-value map for a single habit
  const habitYearMap = (habitId) => {
    const map = {};
    Object.entries(weeks).forEach(([wk, byH]) => {
      const habitWeek = byH[habitId];
      if (!habitWeek) return;
      const [y, m, d] = wk.split('-').map(Number);
      const start = new Date(y, m - 1, d);
      DAY_KEYS.forEach((dk, di) => {
        if (habitWeek[dk]) {
          const day = new Date(start);
          day.setDate(day.getDate() + di);
          map[dateKey(day)] = 1;
        }
      });
    });
    return map;
  };

// Aggregate stats for header — week pulse now measures progress toward each habit's target
const totalAllCells = habits.length * 7;
const weekDone = habits.reduce((s, h) => s + weekDoneCount(h.id), 0);
const totalTargets = habits.reduce((s, h) => s + (h.target || 7), 0);
const weekTargetProgress = habits.reduce(
  (s, h) => s + Math.min(weekDoneCount(h.id), h.target || 7),
  0
);
const weekPct = totalTargets > 0
  ? Math.round((weekTargetProgress / totalTargets) * 100)
  : 0;

  // Habits hitting target this week
  const onTargetCount = habits.filter((h) => weekDoneCount(h.id) >= (h.target || 7)).length;

  return (
    <PageFrame
      index={4}
      title="Habit Tracker"
      subtitle="Daily ritual grid. Consistency compounds. Each habit has a weekly target and tracks streaks across time."
      actions={
        <>
          <div className="inline-flex border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
            {['week', 'month', 'year'].map((v) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={cls(
                  'px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-all',
                  viewMode === v ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/40' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50'
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </>
      }
    >
      {/* Top stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 mb-4">
        <StatBox label="Week Pulse" value={weekPct} unit="%" icon={Flame} color={weekPct >= 70 ? 'emerald' : weekPct >= 40 ? 'amber' : 'zinc'} />
        <StatBox label="On Target" value={onTargetCount} unit={`/ ${habits.length}`} icon={Trophy} color="emerald" />
        <StatBox label="Habits" value={habits.length} icon={ListChecks} color="cyan" />
        <StatBox label="Cells Filled" value={weekDone} unit={`/ ${totalAllCells}`} icon={Check} color="emerald" />
      </div>

      {/* ─────────── WEEK VIEW ─────────── */}
      {viewMode === 'week' && (
        <Panel
          title="Weekly.Grid"
          right={
            <div className="flex items-center gap-1">
              <Btn size="sm" onClick={() => setWeekOffset((w) => w - 1)} title="Previous week">
                <ChevronLeft className="h-3 w-3" />
              </Btn>
              <span className="font-mono text-[11px] tabular-nums text-zinc-800 px-3 min-w-[140px] text-center">
                {weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : weekOffset === 1 ? 'Next week' : `${weekOffset > 0 ? '+' : ''}${weekOffset}w`}
              </span>
              <Btn size="sm" onClick={() => setWeekOffset((w) => w + 1)} disabled={weekOffset >= 0} title="Next week">
                <ChevronRight className="h-3 w-3" />
              </Btn>
              {weekOffset !== 0 && (
                <Btn size="sm" onClick={() => setWeekOffset(0)}>today</Btn>
              )}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left px-3 py-2 w-44">
                    <Label>Habit</Label>
                  </th>
                  {weekDates.map((d, i) => (
                    <th key={i} className={cls('text-center px-2 py-2 min-w-[44px]', i === todayIdx && 'bg-emerald-500/[0.04]')}>
                      <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">{DAYS[i]}</div>
                      <div className={cls(
                        'font-mono text-[11px] tabular-nums mt-0.5',
                        i === todayIdx ? 'text-emerald-700 font-bold' : 'text-zinc-700'
                      )}>
                        {d.getDate()}
                      </div>
                    </th>
                  ))}
                  <th className="text-center px-2 py-2 w-20">
                    <Label>Streak</Label>
                  </th>
                  <th className="text-center px-2 py-2 w-20">
                    <Label>Target</Label>
                  </th>
                </tr>
              </thead>
              <tbody>
                {habits.map((habit) => {
                  const row = getWeekData(currentWeekKey, habit.id);
                  const streak = calcStreak(habit.id);
                  const done = weekDoneCount(habit.id);
                  const target = habit.target || 7;
                  const targetHit = done >= target;
                  return (
                    <tr key={habit.id} className="border-t border-zinc-200/60 group">
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-2 group/habit">
                          <button
                            onClick={() => setShowEmojiPicker(showEmojiPicker === habit.id ? null : habit.id)}
                            className="text-lg leading-none hover:scale-110 transition-transform"
                            title="Change emoji"
                          >
                            {habit.emoji || '🎯'}
                          </button>
                          {editingHabit === habit.id ? (
                            <input
                              autoFocus
                              defaultValue={habit.name}
                              onBlur={(e) => { updateHabit(habit.id, { name: e.target.value.trim() || habit.name }); setEditingHabit(null); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingHabit(null); }}
                              className="bg-zinc-50 border border-emerald-500/60 px-2 py-0.5 font-mono text-[12px] text-zinc-900 focus:outline-none flex-1 min-w-0"
                            />
                          ) : (
                            <span
                              onDoubleClick={() => setEditingHabit(habit.id)}
                              className="font-mono text-[12px] text-zinc-800 uppercase tracking-wider cursor-text truncate flex-1"
                              title="Double-click to rename"
                            >
                              {habit.name}
                            </span>
                          )}
                          <button
                            onClick={() => delHabit(habit.id)}
                            className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-600 shrink-0"
                            title="Delete habit"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        {showEmojiPicker === habit.id && (
                          <div className="mt-1.5 p-1.5 border border-zinc-200 bg-white grid grid-cols-10 gap-0.5">
                            {HABIT_EMOJI.map((e) => (
                              <button
                                key={e}
                                onClick={() => { updateHabit(habit.id, { emoji: e }); setShowEmojiPicker(null); }}
                                className="h-6 w-6 text-base hover:bg-emerald-500/[0.06] flex items-center justify-center"
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      {DAY_KEYS.map((dk, i) => {
                        const on = !!row[dk];
                        const isTodayCell = i === todayIdx && weekOffset === 0;
                        return (
                          <td key={dk} className="px-2 py-1.5 text-center">
                            <button
                              onClick={() => toggleCell(habit.id, dk)}
                              className={cls(
                                'h-9 w-full max-w-[44px] mx-auto border flex items-center justify-center transition-all duration-150',
                                on
                                  ? 'border-emerald-500/60 bg-emerald-500/30 shadow-[0_0_12px_-2px_#10b981] hover:bg-emerald-500/40'
                                  : isTodayCell
                                  ? 'border-emerald-500/30 bg-emerald-500/[0.04] hover:border-emerald-500/60 hover:bg-emerald-500/10'
                                  : 'border-zinc-200 bg-zinc-50 hover:border-zinc-400'
                              )}
                            >
                              {on && <Check className="h-3.5 w-3.5 text-emerald-700" strokeWidth={3} />}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-center">
                        <div className="inline-flex items-center gap-1">
                          <Flame className={cls('h-3 w-3', streak > 0 ? 'text-amber-600' : 'text-zinc-400')} />
                          <span className={cls(
                            'font-mono text-[12px] tabular-nums font-bold',
                            streak > 7 ? 'text-amber-600' : streak > 0 ? 'text-zinc-900' : 'text-zinc-400'
                          )}>
                            {streak}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <div className="inline-flex flex-col items-center gap-0.5">
                          <span className={cls(
                            'font-mono text-[11px] tabular-nums',
                            targetHit ? 'text-emerald-700 font-bold' : 'text-zinc-600'
                          )}>
                            {done}/{target} {targetHit && '✓'}
                          </span>
                          <div className="h-1 w-12 bg-zinc-100 overflow-hidden">
                            <div
                              className={cls(
                                'h-full transition-all',
                                targetHit ? 'bg-emerald-500' : 'bg-zinc-400'
                              )}
                              style={{ width: `${Math.min((done / target) * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Add habit */}
          <div className="mt-4 pt-3 border-t border-zinc-200/60">
            {showAddForm ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={newHabitName}
                  onChange={(e) => setNewHabitName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addHabit(); if (e.key === 'Escape') setShowAddForm(false); }}
                  placeholder="Habit name (e.g. Meditation)"
                  className="flex-1 max-w-xs"
                />
                <Btn size="sm" variant="primary" onClick={addHabit}>Add</Btn>
                <Btn size="sm" onClick={() => setShowAddForm(false)}>Cancel</Btn>
              </div>
            ) : (
              <Btn onClick={() => setShowAddForm(true)}><Plus className="h-3 w-3" />New habit</Btn>
            )}
          </div>
        </Panel>
      )}

      {/* ─────────── MONTH VIEW ─────────── */}
      {viewMode === 'month' && (
        <Panel
          title="Monthly.Grid"
          right={
            <div className="flex items-center gap-1">
              <Btn size="sm" onClick={() => setMonthOffset((m) => m - 1)}><ChevronLeft className="h-3 w-3" /></Btn>
              <span className="font-mono text-[11px] tabular-nums text-zinc-800 px-3 min-w-[160px] text-center">
                {formatMonth(shiftMonth(getMonthKey(), monthOffset))}
              </span>
              <Btn size="sm" onClick={() => setMonthOffset((m) => m + 1)} disabled={monthOffset >= 0}><ChevronRight className="h-3 w-3" /></Btn>
              {monthOffset !== 0 && <Btn size="sm" onClick={() => setMonthOffset(0)}>today</Btn>}
            </div>
          }
        >
          <MonthlyHabitGrid habits={habits} weeks={weeks} monthOffset={monthOffset} />
        </Panel>
      )}

      {/* ─────────── YEAR VIEW ─────────── */}
      {viewMode === 'year' && (
        <div className="space-y-3">
          {habits.length === 0 ? (
            <EmptyState icon={Flame} title="No habits yet" subtitle="Switch to Week view and add your first habit." />
          ) : habits.map((habit) => {
            const yearMap = habitYearMap(habit.id);
            const totalDays = calcTotalDays(habit.id);
            const longest = calcLongestStreak(habit.id);
            const current = calcStreak(habit.id);
            const best = bestDayOfWeek(habit.id);
            return (
              <Panel key={habit.id} title={`${habit.emoji || '🎯'} ${habit.name}`} className="!p-3">
                <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
                  <YearHeatmap dayValues={yearMap} max={1} />
                  <div className="space-y-2">
                    <YearStatRow label="Current streak" value={current} unit="days" color={current > 7 ? 'amber' : 'zinc'} icon={Flame} />
                    <YearStatRow label="Longest streak" value={longest} unit="days" color="emerald" icon={Trophy} />
                    <YearStatRow label="Total days" value={totalDays} icon={Check} color="cyan" />
                    <YearStatRow label="Best day" value={best} icon={Calendar} />
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </PageFrame>
  );
}

function YearStatRow({ label, value, unit, icon: Icon, color = 'zinc' }) {
  const colors = {
    zinc: 'text-zinc-700',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    cyan: 'text-cyan-700',
  };
  return (
    <div className="flex items-center justify-between border border-zinc-200 bg-zinc-50/50 px-2.5 py-1.5">
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <span className={cls('font-mono text-sm tabular-nums font-bold', colors[color])}>
        {value}{unit && <span className="text-[10px] uppercase tracking-wider opacity-70 ml-1">{unit}</span>}
      </span>
    </div>
  );
}

function MonthlyHabitGrid({ habits, weeks, monthOffset }) {
  const monthKey = shiftMonth(getMonthKey(), monthOffset);
  const [y, m] = monthKey.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const todayKey = dateKey(new Date());

  // Build day cells
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m - 1, d);
    const wk = getWeekKey(date);
    const dk = DAY_KEYS[date.getDay() === 0 ? 6 : date.getDay() - 1];
    days.push({ d, date, wk, dk, key: dateKey(date) });
  }

  // Pad start to align with Monday (1=Mon, 7=Sun in our model)
  const firstDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const padded = Array(firstDayOfWeek).fill(null).concat(days);

  return (
    <div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DAYS.map((d) => (
          <div key={d} className="text-center font-mono text-[9px] uppercase tracking-wider text-zinc-400">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {padded.map((cell, i) => {
          if (!cell) return <div key={i} className="h-16" />;
          const isToday = cell.key === todayKey;
          const dayHabits = habits.map((h) => ({ h, on: !!weeks[cell.wk]?.[h.id]?.[cell.dk] }));
          const doneCount = dayHabits.filter((x) => x.on).length;
          return (
            <div
              key={i}
              className={cls(
                'h-16 border p-1 flex flex-col bg-white/60',
                isToday ? 'border-emerald-500/60 shadow-[0_0_8px_-2px_#10b981]' : 'border-zinc-200'
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cls(
                  'font-mono text-[10px] tabular-nums',
                  isToday ? 'text-emerald-700 font-bold' : 'text-zinc-600'
                )}>
                  {cell.d}
                </span>
                {doneCount > 0 && (
                  <span className="font-mono text-[8px] text-emerald-700 tabular-nums">{doneCount}/{habits.length}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-0.5 mt-0.5">
                {dayHabits.filter((x) => x.on).slice(0, 8).map(({ h }, idx) => (
                  <span key={idx} className="text-[9px] leading-none" title={h.name}>{h.emoji || '✓'}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   FINANCE — monthly ledger, per-category budgets, comparison sparklines
   ════════════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════════════
   FINANCE NOTES — freeform editable note panel (balance snapshots, debts, goals)
   ════════════════════════════════════════════════════════════════════════ */

function FinanceNotes({ notes, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes || '');
  const taRef = useRef(null);

  // Sync external changes when not editing
  useEffect(() => {
    if (!editing) setDraft(notes || '');
  }, [notes, editing]);

  const save = () => {
    onChange(draft);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(notes || '');
    setEditing(false);
  };
  const enterEdit = () => {
    setDraft(notes || '');
    setEditing(true);
    setTimeout(() => taRef.current?.focus(), 50);
  };

  return (
    <Panel
      title="Balance.Notes"
      accent="emerald"
      right={
        editing ? (
          <div className="flex items-center gap-1">
            <Btn size="sm" onClick={cancel}>Cancel</Btn>
            <Btn size="sm" variant="primary" onClick={save}>
              <Check className="h-3 w-3" />
              Save
            </Btn>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 hidden sm:inline">
              freeform · click to edit
            </span>
            <Btn size="sm" onClick={enterEdit}>
              <Edit3 className="h-3 w-3" />
              Edit
            </Btn>
          </div>
        )
      }
      className="mb-4"
    >
      {editing ? (
        <>
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); cancel(); }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
            }}
            placeholder="Запиши скільки відкладено, скільки винні, балансові снапшоти, цілі..."
            rows={Math.max(12, Math.min(28, (draft.split('\n').length || 12)))}
            className="w-full bg-zinc-50 border border-zinc-200 px-3 py-2.5 font-mono text-[12px] text-zinc-900 leading-relaxed placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500/60 focus:bg-emerald-500/[0.02] focus:shadow-[0_0_0_1px_rgba(16,185,129,0.2)] transition-all resize-y"
          />
          <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-400 flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1">
              <KbdKey>⌘</KbdKey><KbdKey>↵</KbdKey> save
            </span>
            <span className="flex items-center gap-1">
              <KbdKey>esc</KbdKey> cancel
            </span>
            <span className="text-zinc-300">·</span>
            <span>{draft.length} chars · {draft.split('\n').length} lines</span>
          </div>
        </>
      ) : (
        <div
          onClick={enterEdit}
          onDoubleClick={enterEdit}
          className="group cursor-text relative"
          title="Click to edit"
        >
          {notes && notes.trim() ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] text-zinc-800 leading-relaxed border border-zinc-200/60 bg-zinc-50/40 px-3 py-2.5 group-hover:border-emerald-500/40 group-hover:bg-emerald-500/[0.02] transition-all min-h-[80px]">
              {notes}
            </pre>
          ) : (
            <div className="border border-dashed border-zinc-300 bg-zinc-50/40 px-3 py-6 text-center group-hover:border-emerald-500/60 group-hover:bg-emerald-500/[0.02] transition-all">
              <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
                empty — click to add notes
              </div>
              <div className="text-[11px] text-zinc-400">
                Track savings snapshots, owed debts, financial goals, anything.
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Finance({ data, setData, showToast, openBulkImport }) {
  const [monthKey, setMonthKey] = useState(getMonthKey());
  const [quickInput, setQuickInput] = useState('');
  const [showBudgets, setShowBudgets] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [incInput, setIncInput] = useState({ source: '', amount: '', date: todayLocalISO() });
  const [expInput, setExpInput] = useState({ desc: '', amount: '', category: 'Food', date: todayLocalISO() });

  const cur = data.finance.currency || 'UAH';
  const limit = data.finance.limit || 0;

  // Always return a normalized month structure (transfers may be missing in older data)
  const month = useMemo(() => {
    const m = data.finance.months[monthKey] || {};
    return {
      income: m.income || [],
      expenses: m.expenses || [],
      transfers: m.transfers || [],
    };
  }, [data.finance.months, monthKey]);

  const totalIncome = month.income.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const totalExpenses = month.expenses.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const totalTransfers = month.transfers.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const balance = totalIncome - totalExpenses - totalTransfers;
  const limitPct = limit > 0 ? Math.round((totalExpenses / limit) * 100) : 0;

  // By category
  const byCategory = useMemo(() => {
    const m = {};
    data.finance.expenseCategories.forEach((c) => { m[c] = 0; });
    month.expenses.forEach((e) => {
      const c = e.category || 'Other';
      m[c] = (m[c] || 0) + (Number(e.amount) || 0);
    });
    return m;
  }, [month, data.finance.expenseCategories]);

  // Top 5 largest expenses
  const topExpenses = useMemo(() => {
    return [...month.expenses]
      .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
      .slice(0, 5);
  }, [month]);

  // Daily spend within month
  const dailySpend = useMemo(() => {
    const [y, m] = monthKey.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const arr = Array(days).fill(0);
    month.expenses.forEach((e) => {
      const d = (e.date || '').slice(0, 10);
      if (!d) return;
      const day = parseInt(d.slice(8, 10));
      if (day >= 1 && day <= days) arr[day - 1] += Number(e.amount) || 0;
    });
    return arr;
  }, [month, monthKey]);

  // NEW: Cumulative daily balance (running net = income - expenses - transfers, day by day)
  const cumulativeBalance = useMemo(() => {
    const [y, m] = monthKey.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const arr = Array(days).fill(0);
    let running = 0;
    for (let day = 1; day <= days; day++) {
      const dk = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayIn = month.income
        .filter((x) => (x.date || '').slice(0, 10) === dk)
        .reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const dayEx = month.expenses
        .filter((x) => (x.date || '').slice(0, 10) === dk)
        .reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const dayTr = month.transfers
        .filter((x) => (x.date || '').slice(0, 10) === dk)
        .reduce((s, x) => s + (Number(x.amount) || 0), 0);
      running += dayIn - dayEx - dayTr;
      arr[day - 1] = running;
    }
    return arr;
  }, [month, monthKey]);

  // Last 6 months comparison
  const last6Months = useMemo(() => {
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      const mk = shiftMonth(monthKey, -i);
      const m = data.finance.months[mk] || { income: [], expenses: [], transfers: [] };
      const inc = (m.income || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const exp = (m.expenses || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
      arr.push({ key: mk, label: formatMonth(mk).slice(0, 3), inc, exp, net: inc - exp });
    }
    return arr;
  }, [monthKey, data.finance.months]);

  // Goals: group transfers across all months
  const goals = useMemo(() => {
    const map = {};
    Object.values(data.finance.months).forEach((m) => {
      (m.transfers || []).forEach((t) => {
        const goal = (t.goal || '').toLowerCase().trim();
        if (!goal) return;
        map[goal] = (map[goal] || 0) + (Number(t.amount) || 0);
      });
    });
    return Object.entries(map)
      .map(([goal, amount]) => ({ goal, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [data.finance.months]);

  /* ───── Helpers ───── */

  const addEntry = (type, amount, desc, dateStr) => {
    if (!amount || amount <= 0) return;
    const date = dateStr || todayLocalISO();
    const mk = date.slice(0, 7);
    const isoDate = date.length === 10 ? `${date}T12:00:00.000Z` : date;
    const entry = { id: uid(), amount: Number(amount), date: isoDate };

    setData((d) => {
      const months = { ...d.finance.months };
      const existing = months[mk] || { income: [], expenses: [], transfers: [] };
      const next = {
        income: [...(existing.income || [])],
        expenses: [...(existing.expenses || [])],
        transfers: [...(existing.transfers || [])],
      };
      if (type === 'income') { entry.source = desc || '?'; next.income = [entry, ...next.income]; }
      else if (type === 'transfer') { entry.goal = desc || '?'; next.transfers = [entry, ...next.transfers]; }
      else { entry.desc = desc || '?'; entry.category = ''; next.expenses = [entry, ...next.expenses]; }
      return { ...d, finance: { ...d.finance, months: { ...months, [mk]: next } } };
    });

    if (type === 'income') logActivity(setData, 'finance_in', `+${fmtNum(amount)} ${cur} — ${desc || '?'}`);
    else if (type === 'transfer') logActivity(setData, 'finance_in', `→ ${fmtNum(amount)} ${cur} · ${desc || '?'}`);
    else logActivity(setData, 'finance_out', `−${fmtNum(amount)} ${cur} — ${desc || '?'}`);
  };

  /* ───── Quick capture ───── */

  const parsed = useMemo(() => {
    if (!quickInput.trim()) return null;
    return parseFinanceLine(quickInput, todayLocalISO());
  }, [quickInput]);

  const commitQuick = () => {
    if (!parsed) return;
    addEntry(parsed.type, parsed.amount, parsed.desc, parsed.date);
    setQuickInput('');
  };

  /* ───── Advanced add (legacy forms) ───── */

  const addIncome = () => {
    const amt = Number(incInput.amount);
    if (!incInput.source.trim() || !amt) return;
    addEntry('income', amt, incInput.source.trim(), incInput.date);
    setIncInput({ source: '', amount: '', date: todayLocalISO() });
  };

  const addExpense = () => {
    const amt = Number(expInput.amount);
    if (!expInput.desc.trim() || !amt) return;
    const date = expInput.date || todayLocalISO();
    const mk = date.slice(0, 7);
    const isoDate = `${date}T12:00:00.000Z`;
    const entry = { id: uid(), amount: amt, date: isoDate, desc: expInput.desc.trim(), category: expInput.category };
    
    setData((d) => {
      const months = { ...d.finance.months };
      const existing = months[mk] || { income: [], expenses: [], transfers: [] };
      const next = {
        income: [...(existing.income || [])],
        expenses: [entry, ...(existing.expenses || [])],
        transfers: [...(existing.transfers || [])],
      };
      return { ...d, finance: { ...d.finance, months: { ...months, [mk]: next } } };
    });
    
    logActivity(setData, 'finance_out', `−${fmtNum(amt)} ${cur} — ${entry.desc}`);
    setExpInput({ desc: '', amount: '', category: expInput.category, date: todayLocalISO() });
  };

  /* ───── Delete handlers ───── */

  const delEntry = (type, id) => {
    setData((d) => {
      const months = { ...d.finance.months };
      const existing = months[monthKey] || { income: [], expenses: [], transfers: [] };
      const key = type === 'income' ? 'income' : type === 'transfer' ? 'transfers' : 'expenses';
      const next = {
        income: existing.income || [],
        expenses: existing.expenses || [],
        transfers: existing.transfers || [],
      };
      next[key] = next[key].filter((x) => x.id !== id);
      return { ...d, finance: { ...d.finance, months: { ...months, [monthKey]: next } } };
    });
  };

  const updateBudget = (cat, val) => {
    const n = Number(val) || 0;
    setData((d) => ({ ...d, finance: { ...d.finance, budgets: { ...(d.finance.budgets || {}), [cat]: n } } }));
  };

  const updateLimit = (val) => {
    setData((d) => ({ ...d, finance: { ...d.finance, limit: Number(val) || 0 } }));
  };

  const updateCurrency = (val) => {
    setData((d) => ({ ...d, finance: { ...d.finance, currency: val } }));
  };

  const today = new Date();
  const isCurrentMonth = monthKey === getMonthKey();
  const daysSoFar = isCurrentMonth ? today.getDate() : (() => {
    const [y, m] = monthKey.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  })();
  const avgDaily = totalExpenses > 0 ? Math.round(totalExpenses / (daysSoFar || 1)) : 0;

  return (
    <PageFrame
      index={5}
      title="Finance Report"
      subtitle={`${formatMonth(monthKey)}. ${month.income.length + month.expenses.length + month.transfers.length} entries · ${fmtNum(totalIncome)} in / ${fmtNum(totalExpenses)} out / ${totalTransfers ? fmtNum(totalTransfers) + ' transfers' : 'no transfers'}.`}
      actions={
        <>
          <Btn onClick={openBulkImport}><Upload className="h-3 w-3" /> Bulk paste</Btn>
          <Btn onClick={() => setShowBudgets((s) => !s)} variant={showBudgets ? 'primary' : 'ghost'}>
            <Hash className="h-3 w-3" /> Budgets
          </Btn>
          <div className="flex items-center gap-1">
            <Btn size="sm" onClick={() => setMonthKey(shiftMonth(monthKey, -1))}><ChevronLeft className="h-3 w-3" /></Btn>
            <span className="font-mono text-[11px] tabular-nums text-zinc-800 px-3 min-w-[140px] text-center">
              {formatMonth(monthKey)}
            </span>
            <Btn size="sm" onClick={() => setMonthKey(shiftMonth(monthKey, 1))}><ChevronRight className="h-3 w-3" /></Btn>
            {!isCurrentMonth && <Btn size="sm" onClick={() => setMonthKey(getMonthKey())}>today</Btn>}
          </div>
        </>
      }
    >
      {/* KPI row */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-4">
        <StatBox label="Income" value={fmtNum(totalIncome)} unit={cur} icon={TrendingUp} color="emerald" />
        <StatBox label="Expenses" value={fmtNum(totalExpenses)} unit={cur} icon={TrendingDown} color="red" />
        <StatBox label="Net" value={fmtNum(balance)} unit={cur} icon={Wallet} color={balance < 0 ? 'red' : 'emerald'} />
        <StatBox label="Avg / Day" value={fmtNum(avgDaily)} unit={cur} icon={Calendar} color={limitPct > 80 ? 'amber' : 'cyan'} />
      </div>

      {/* Cap bar */}
      <Panel
        title="Cap.Limit"
        right={
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-zinc-500">limit</span>
            <Input
              type="number"
              value={limit || ''}
              onChange={(e) => updateLimit(e.target.value)}
              className="w-24 text-right"
            />
            <select
              value={cur}
              onChange={(e) => updateCurrency(e.target.value)}
              className="bg-zinc-50 border border-zinc-200 px-2 py-1 font-mono text-[12px] text-zinc-900 focus:outline-none focus:border-emerald-500/60"
            >
              {['UAH','USD','EUR','GBP','PLN'].map((c) => <option key={c} value={c} className="bg-white">{c}</option>)}
            </select>
          </div>
        }
        className="mb-4"
      >
        <div className="relative h-6 bg-zinc-100 border border-zinc-200 overflow-hidden">
          {[25, 50, 75].map((t) => (
            <div key={t} className="absolute top-0 bottom-0 w-px bg-zinc-300" style={{ left: `${t}%` }} />
          ))}
          <div
            className={cls(
              'h-full transition-all duration-500 flex items-center justify-end pr-2',
              limitPct > 100 ? 'bg-gradient-to-r from-red-600 to-red-500 shadow-[0_0_18px_#ef4444]' :
              limitPct > 80 ? 'bg-gradient-to-r from-amber-600 to-amber-500 shadow-[0_0_18px_#f59e0b]' :
              'bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-[0_0_18px_#10b981]'
            )}
            style={{ width: `${Math.min(limitPct, 100)}%` }}
          >
            {limitPct > 15 && (
              <span className="font-mono text-[11px] font-bold tabular-nums text-black/80">
                {fmtNum(totalExpenses)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 font-mono text-[10px] uppercase tracking-wider">
          <span className="text-zinc-500">{limitPct}% of {fmtNum(limit)} {cur}</span>
          {limitPct > 100 ? (
            <span className="flex items-center gap-1 text-red-600">
              <AlertTriangle className="h-3 w-3" /> Over by {fmtNum(totalExpenses - limit)} {cur}
            </span>
          ) : (
            <span className="text-zinc-500">{fmtNum(Math.max(0, limit - totalExpenses))} {cur} remaining</span>
          )}
        </div>
      </Panel>

      {/* QUICK CAPTURE — main input */}
      <Panel
        title="Quick.Capture"
        accent={parsed?.type === 'income' ? 'emerald' : parsed?.type === 'transfer' ? 'cyan' : 'emerald'}
        right={
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 hidden sm:inline">
            <span className="text-zinc-400">format:</span> <span className="text-zinc-700">±N desc</span> · <span className="text-zinc-700">Переказ: N goal</span>
          </span>
        }
        className="mb-4"
      >
        <div className={cls(
          'flex items-center gap-3 border px-3 py-2.5 transition-all duration-150',
          parsed?.type === 'income' ? 'border-emerald-500/60 bg-emerald-500/[0.04] shadow-[0_0_0_1px_rgba(16,185,129,0.2)]' :
          parsed?.type === 'expense' ? 'border-red-500/60 bg-red-500/[0.04] shadow-[0_0_0_1px_rgba(239,68,68,0.2)]' :
          parsed?.type === 'transfer' ? 'border-cyan-500/60 bg-cyan-500/[0.04] shadow-[0_0_0_1px_rgba(6,182,212,0.2)]' :
          'border-zinc-200 bg-zinc-50 focus-within:border-emerald-500/60'
        )}>
          {parsed?.type === 'income' ? <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0" /> :
            parsed?.type === 'transfer' ? <ArrowRight className="h-4 w-4 text-cyan-600 shrink-0" /> :
            parsed?.type === 'expense' ? <TrendingDown className="h-4 w-4 text-red-600 shrink-0" /> :
            <Plus className="h-4 w-4 text-zinc-400 shrink-0" />}
          <input
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitQuick(); }}
            placeholder='Type entry — e.g. "-30 булочка" or "+500 мама" or "Переказ: 1000 айфон"…'
            className="flex-1 bg-transparent font-mono text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          />
          {parsed && (
            <span className={cls(
              'font-mono text-[13px] font-bold tabular-nums shrink-0',
              parsed.type === 'income' ? 'text-emerald-700' :
              parsed.type === 'transfer' ? 'text-cyan-700' :
              'text-red-700'
            )}>
              {parsed.type === 'income' ? '+' : parsed.type === 'expense' ? '−' : '→ '}
              {fmtNum(parsed.amount)} {cur}
            </span>
          )}
          <KbdKey>↵</KbdKey>
        </div>
        {parsed && (
          <div className="mt-2 flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-zinc-500 flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="text-zinc-400">type:</span>
              <span className={cls(
                'px-1.5',
                parsed.type === 'income' ? 'text-emerald-700' :
                parsed.type === 'transfer' ? 'text-cyan-700' :
                'text-red-700'
              )}>{parsed.type}</span>
            </span>
            <span className="text-zinc-300">·</span>
            <span className="flex items-center gap-1.5">
              <span className="text-zinc-400">desc:</span>
              <span className="text-zinc-700 normal-case tracking-normal">{parsed.desc}</span>
            </span>
            <span className="text-zinc-300">·</span>
            <span className="flex items-center gap-1.5">
              <span className="text-zinc-400">date:</span>
              <span className="text-zinc-700 tabular-nums">{parsed.date.slice(5)}</span>
            </span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between">
          <button
            onClick={() => setShowAdvanced((s) => !s)}
            className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 hover:text-emerald-700 flex items-center gap-1"
          >
            {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Advanced (form-based)
          </button>
        </div>
        {showAdvanced && (
          <div className="mt-3 pt-3 border-t border-zinc-200/60 grid gap-3 lg:grid-cols-2">
            <div>
              <Label>Add income</Label>
              <div className="grid grid-cols-[1fr_80px_110px_auto] gap-1.5 mt-1">
                <Input value={incInput.source} onChange={(e) => setIncInput({ ...incInput, source: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addIncome()} placeholder="Source" />
                <Input type="number" value={incInput.amount} onChange={(e) => setIncInput({ ...incInput, amount: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addIncome()} placeholder="Amount" />
                <Input type="date" value={incInput.date} onChange={(e) => setIncInput({ ...incInput, date: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addIncome()} />
                <Btn variant="primary" onClick={addIncome}><Plus className="h-3 w-3" /></Btn>
              </div>
            </div>
            <div>
              <Label>Add expense</Label>
              <div className="grid grid-cols-[1fr_70px_80px_110px_auto] gap-1.5 mt-1">
                <Input value={expInput.desc} onChange={(e) => setExpInput({ ...expInput, desc: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addExpense()} placeholder="What for" />
                <Input type="number" value={expInput.amount} onChange={(e) => setExpInput({ ...expInput, amount: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addExpense()} placeholder="Amount" />
                <select value={expInput.category} onChange={(e) => setExpInput({ ...expInput, category: e.target.value })} className="bg-zinc-50 border border-zinc-200 px-2 py-1.5 font-mono text-[12px] text-zinc-900 focus:outline-none focus:border-emerald-500/60">
                  {data.finance.expenseCategories.map((c) => <option key={c} value={c} className="bg-white">{c}</option>)}
                </select>
                <Input type="date" value={expInput.date} onChange={(e) => setExpInput({ ...expInput, date: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addExpense()} />
                <Btn variant="primary" onClick={addExpense}><Plus className="h-3 w-3" /></Btn>
              </div>
            </div>
          </div>
        )}
      </Panel>

      {/* Balance Notes — freeform */}
      <FinanceNotes
        notes={data.finance.notes || ''}
        onChange={(notes) => setData((d) => ({ ...d, finance: { ...d.finance, notes } }))}
      />

      {/* Charts row */}
      <div className="grid gap-3 lg:grid-cols-3 mb-4">
        <Panel title="6-Month.Trend">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <Label>Income</Label>
              <Sparkline data={last6Months.map((m) => m.inc)} color="#10b981" height={40} />
            </div>
            <div>
              <Label>Expenses</Label>
              <Sparkline data={last6Months.map((m) => m.exp)} color="#ef4444" height={40} />
            </div>
          </div>
          <div className="grid grid-cols-6 gap-0.5 mt-2">
            {last6Months.map((m) => (
              <div key={m.key} className="text-center">
                <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-400">{m.label}</div>
                <div className={cls(
                  'font-mono text-[10px] tabular-nums mt-0.5',
                  m.net < 0 ? 'text-red-600' : 'text-emerald-700'
                )}>
                  {m.net >= 0 ? '+' : ''}{fmtNum(m.net)}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Daily.Balance" right={<span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">cumulative</span>}>
          <Sparkline data={cumulativeBalance} color={balance < 0 ? '#ef4444' : '#10b981'} height={70} area={true} />
          <div className="grid grid-cols-3 gap-1 mt-3 pt-3 border-t border-zinc-200/60 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <div>
              <div>Min</div>
              <div className={cls('text-sm font-bold tabular-nums mt-0.5', Math.min(...cumulativeBalance) < 0 ? 'text-red-700' : 'text-zinc-900')}>
                {fmtNum(Math.min(...cumulativeBalance))}
              </div>
            </div>
            <div>
              <div>Max</div>
              <div className="text-sm font-bold tabular-nums mt-0.5 text-emerald-700">
                {fmtNum(Math.max(...cumulativeBalance))}
              </div>
            </div>
            <div>
              <div>Now</div>
              <div className={cls('text-sm font-bold tabular-nums mt-0.5', balance < 0 ? 'text-red-700' : 'text-emerald-700')}>
                {fmtNum(balance)}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Daily.Spend">
          <Sparkline data={dailySpend} color="#ef4444" height={50} />
          <div className="flex items-center justify-between mt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <span>Day 1</span>
            <span>Day {dailySpend.length}</span>
          </div>
          <div className="mt-3 pt-3 border-t border-zinc-200/60">
            <Label>Top expenses</Label>
            <div className="space-y-1 mt-1.5">
              {topExpenses.length === 0 ? (
                <div className="font-mono text-[11px] text-zinc-400">No expenses yet</div>
              ) : topExpenses.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-zinc-700 truncate">{e.desc}</span>
                  <span className="font-mono text-zinc-900 tabular-nums shrink-0">{fmtNum(e.amount)} {cur}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {/* Budgets panel */}
      {showBudgets && (
        <Panel title="Category.Budgets" className="mb-4" right={<Label>{cur}/month</Label>}>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
            {data.finance.expenseCategories.map((cat) => {
              const spent = byCategory[cat] || 0;
              const budget = data.finance.budgets?.[cat] || 0;
              const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
              const over = budget > 0 && spent > budget;
              return (
                <div key={cat} className={cls(
                  'border bg-white/60 px-3 py-2',
                  over ? 'border-red-500/40 bg-red-50/30' : 'border-zinc-200'
                )}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-700">{cat}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={cls(
                        'font-mono text-[11px] tabular-nums',
                        over ? 'text-red-700 font-bold' : 'text-zinc-800'
                      )}>
                        {fmtNum(spent)}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400">/</span>
                      <Input
                        type="number"
                        value={budget || ''}
                        onChange={(e) => updateBudget(cat, e.target.value)}
                        placeholder="0"
                        className="w-16 text-right !text-[11px] !py-0.5"
                      />
                    </div>
                  </div>
                  {budget > 0 && (
                    <>
                      <div className="h-1.5 bg-zinc-100 overflow-hidden">
                        <div
                          className={cls(
                            'h-full transition-all duration-500',
                            over ? 'bg-red-500 shadow-[0_0_6px_-1px_#ef4444]' :
                            pct > 80 ? 'bg-amber-500' :
                            'bg-emerald-500'
                          )}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <div className={cls(
                        'mt-1 font-mono text-[9px] uppercase tracking-wider',
                        over ? 'text-red-600' : 'text-zinc-500'
                      )}>
                        {pct}% used · {fmtNum(Math.max(0, budget - spent))} {cur} left
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Goals progress (only if there are any transfers across all time) */}
      {goals.length > 0 && (
        <Panel
          title="Savings.Goals"
          accent="cyan"
          right={<span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">all-time</span>}
          className="mb-4"
        >
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {goals.slice(0, 6).map((g) => (
              <div key={g.goal} className="border border-cyan-500/30 bg-cyan-500/[0.04] px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-cyan-700 truncate flex items-center gap-1.5">
                    <ArrowRight className="h-3 w-3" />
                    {g.goal}
                  </span>
                  <span className="font-mono text-[13px] font-bold tabular-nums text-cyan-800">
                    {fmtNum(g.amount)} {cur}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Ledgers — Income + Expenses (2-col) */}
      <div className="grid gap-3 lg:grid-cols-2 mb-3">
        <Panel
          title="Income.Ledger"
          accent="emerald"
          right={<span className="font-mono text-[11px] tabular-nums text-emerald-700">+{fmtNum(totalIncome)} {cur}</span>}
        >
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {month.income.length === 0 ? (
              <EmptyState icon={TrendingUp} title="No income this month" subtitle="Use Quick Capture above to add one." />
            ) : month.income.map((x) => (
              <div key={x.id} className="group flex items-center gap-2 border border-zinc-200 bg-zinc-50/40 px-2.5 py-1.5">
                <span className="font-mono text-[10px] tabular-nums text-zinc-400 shrink-0">{(x.date || '').slice(8, 10)}</span>
                <span className="text-[12px] text-zinc-800 flex-1 truncate">{x.source}</span>
                <span className="font-mono text-[12px] tabular-nums text-emerald-700">+{fmtNum(x.amount)} {cur}</span>
                <button onClick={() => delEntry('income', x.id)} className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-600">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Expense.Ledger"
          accent="red"
          right={<span className="font-mono text-[11px] tabular-nums text-red-700">−{fmtNum(totalExpenses)} {cur}</span>}
        >
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {month.expenses.length === 0 ? (
              <EmptyState icon={TrendingDown} title="No expenses this month" subtitle="Use Quick Capture above to add one." />
            ) : month.expenses.map((x) => (
              <div key={x.id} className="group flex items-center gap-2 border border-zinc-200 bg-zinc-50/40 px-2.5 py-1.5">
                <span className="font-mono text-[10px] tabular-nums text-zinc-400 shrink-0">{(x.date || '').slice(8, 10)}</span>
                <span className="text-[12px] text-zinc-800 flex-1 truncate">{x.desc}</span>
                {x.category && <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 border border-zinc-200 px-1">{x.category}</span>}
                <span className="font-mono text-[12px] tabular-nums text-red-700">−{fmtNum(x.amount)} {cur}</span>
                <button onClick={() => delEntry('expense', x.id)} className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-600">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Transfers ledger */}
      {month.transfers.length > 0 && (
        <Panel
          title="Transfers.Ledger"
          accent="cyan"
          right={<span className="font-mono text-[11px] tabular-nums text-cyan-700">→ {fmtNum(totalTransfers)} {cur}</span>}
        >
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {month.transfers.map((x) => (
              <div key={x.id} className="group flex items-center gap-2 border border-cyan-200 bg-cyan-50/30 px-2.5 py-1.5">
                <ArrowRight className="h-3 w-3 text-cyan-600 shrink-0" />
                <span className="font-mono text-[10px] tabular-nums text-zinc-400 shrink-0">{(x.date || '').slice(8, 10)}</span>
                <span className="text-[12px] text-zinc-800 flex-1 truncate">{x.goal}</span>
                <span className="font-mono text-[12px] tabular-nums text-cyan-700">{fmtNum(x.amount)} {cur}</span>
                <button onClick={() => delEntry('transfer', x.id)} className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-600">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </PageFrame>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   GENERAL TASKS — personal inbox with priority and search
   ════════════════════════════════════════════════════════════════════════ */

function GeneralTasks({ data, setData, showToast }) {
  const [input, setInput] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('created');
  const inputRef = useRef(null);

  const tasks = data.generalTasks || [];

  const add = () => {
    const t = input.trim();
    if (!t) return;
    let title = t;
    let priority = false;
    if (title.startsWith('!')) {
      priority = true;
      title = title.slice(1).trim();
    }
    const newTask = {
      id: uid(),
      title,
      completed: false,
      priority,
      createdAt: new Date().toISOString(),
    };
    setData((d) => ({ ...d, generalTasks: [newTask, ...d.generalTasks] }));
    logActivity(setData, 'task_added', `Task: "${title}"`);
    setInput('');
  };

  const toggle = (id) => {
    const t = tasks.find((x) => x.id === id);
    setData((d) => ({
      ...d,
      generalTasks: d.generalTasks.map((x) => {
        if (x.id !== id) return x;
        const completed = !x.completed;
        const next = { ...x, completed };
        if (completed) next.completedAt = new Date().toISOString();
        else delete next.completedAt;
        return next;
      }),
    }));
    if (t && !t.completed) logActivity(setData, 'task_done', `Done: "${t.title}"`);
  };

  const remove = (id) => {
    setData((d) => ({ ...d, generalTasks: d.generalTasks.filter((x) => x.id !== id) }));
  };

  const togglePriority = (id) => {
    setData((d) => ({
      ...d,
      generalTasks: d.generalTasks.map((x) => x.id === id ? { ...x, priority: !x.priority } : x),
    }));
  };

  const filtered = useMemo(() => {
    let arr = [...tasks];
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      arr = arr.filter((t) => t.title.toLowerCase().includes(q));
    }
    arr.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (sortBy === 'priority' && a.priority !== b.priority) return a.priority ? -1 : 1;
      if (sortBy === 'alpha') return a.title.localeCompare(b.title);
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    return arr;
  }, [tasks, search, sortBy]);

  const open = filtered.filter((t) => !t.completed);
  const done = filtered.filter((t) => t.completed);
  const priorityCount = tasks.filter((t) => !t.completed && t.priority).length;

  return (
    <PageFrame
      index={6}
      title="General Tasks"
      subtitle={`Personal inbox. Press Enter to add. Use ! prefix for priority. ${priorityCount > 0 ? `${priorityCount} priority` : 'Keep this list ruthlessly short.'}`}
      actions={
        <>
          <SortDropdown value={sortBy} onChange={setSortBy} />
          <Btn onClick={() => setShowCompleted((s) => !s)}>
            <Eye className="h-3 w-3" />
            {showCompleted ? 'Hide' : 'Show'} done ({done.length})
          </Btn>
        </>
      }
    >
      {/* Quick add */}
      <div className="mb-3 border border-zinc-200 bg-white/90 p-3 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
        <div className="flex items-center gap-2 border border-zinc-200 bg-zinc-50 px-3 py-2.5 focus-within:border-emerald-500/60 focus-within:shadow-[0_0_0_1px_rgba(16,185,129,0.2)] transition-all">
          <Plus className="h-4 w-4 text-emerald-600" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Quick capture — press Enter to add  (! = priority)"
            className="flex-1 bg-transparent font-mono text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          />
          <KbdKey>↵</KbdKey>
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          <span>{open.length} open · {done.length} done {priorityCount > 0 && `· ${priorityCount} priority`}</span>
          <span>{tasks.length} total</span>
        </div>
      </div>

      {/* Search bar */}
      <div className="mb-3 flex items-center gap-2 border border-zinc-200 bg-white px-3 py-1.5 focus-within:border-emerald-500/60 max-w-md">
        <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks…"
          className="flex-1 bg-transparent text-[12px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-zinc-400 hover:text-zinc-900">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Open tasks */}
      <div className="border border-zinc-200 bg-white/90 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
        <div className="border-b border-zinc-200 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <NeonDot on={open.length > 0} />
            <Label>open</Label>
            <span className="font-mono text-[11px] tabular-nums text-zinc-800">{open.length}</span>
          </div>
        </div>
        {open.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={search ? 'No matches' : 'Inbox zero'}
            subtitle={search ? 'Adjust your search.' : 'All tasks complete. Add a new one above to keep moving.'}
          />
        ) : (
          <div className="divide-y divide-zinc-200/60">
            {open.map((task) => (
              <GeneralTaskRow
                key={task.id}
                task={task}
                onToggle={toggle}
                onRemove={remove}
                onTogglePriority={togglePriority}
              />
            ))}
          </div>
        )}
      </div>

      {/* Completed tasks */}
      {showCompleted && done.length > 0 && (
        <div className="mt-3 border border-zinc-200 bg-white/90 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
          <div className="border-b border-zinc-200 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
              <Label>completed</Label>
              <span className="font-mono text-[11px] tabular-nums text-zinc-500">{done.length}</span>
            </div>
          </div>
          <div className="divide-y divide-zinc-200/60">
            {done.map((task) => (
              <GeneralTaskRow
                key={task.id}
                task={task}
                onToggle={toggle}
                onRemove={remove}
                onTogglePriority={togglePriority}
              />
            ))}
          </div>
        </div>
      )}
    </PageFrame>
  );
}

function GeneralTaskRow({ task, onToggle, onRemove, onTogglePriority }) {
  return (
    <div className={cls(
      'group flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50/60 transition-colors',
      task.completed && 'opacity-50',
      task.priority && !task.completed && 'bg-amber-50/30'
    )}>
      <button
        onClick={() => onToggle(task.id)}
        className={cls(
          'shrink-0 h-4 w-4 border flex items-center justify-center transition-all',
          task.completed ? 'border-emerald-500 bg-emerald-500/20' : 'border-zinc-300 hover:border-emerald-500'
        )}
      >
        {task.completed && <Check className="h-3 w-3 text-emerald-700" strokeWidth={3} />}
      </button>
      <span className={cls(
        'flex-1 text-[13px] truncate',
        task.completed ? 'text-zinc-400 line-through' : 'text-zinc-900'
      )}>
        {task.title}
      </span>
      <button
        onClick={() => onTogglePriority(task.id)}
        title={task.priority ? 'Remove priority' : 'Mark priority'}
        className={cls(
          'opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center transition-all',
          task.priority
            ? 'text-amber-600 opacity-100'
            : 'text-zinc-300 hover:text-amber-600'
        )}
      >
        <Flame className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onRemove(task.id)}
        className="opacity-0 group-hover:opacity-100 h-6 w-6 text-zinc-400 hover:text-red-600 flex items-center justify-center"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   TOASTS — bottom-right notifications
   ════════════════════════════════════════════════════════════════════════ */

function Toasts({ toasts, dismiss }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-[calc(100%-2rem)] sm:w-auto pointer-events-none">
      {toasts.map((t) => {
        const isError = t.type === 'error';
        const isSuccess = t.type === 'success';
        return (
          <div
            key={t.id}
            className={cls(
              'pointer-events-auto flex items-start gap-2.5 border bg-white/95 backdrop-blur px-3.5 py-2.5 shadow-[0_8px_28px_-8px_rgba(24,24,27,0.18)] animate-[slideUp_0.25s_ease-out]',
              isError ? 'border-red-500/60 shadow-[0_0_30px_-8px_#ef4444]' :
              isSuccess ? 'border-emerald-500/60 shadow-[0_0_30px_-8px_#10b981]' :
              'border-zinc-300'
            )}
          >
            {isError ? <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" /> :
              isSuccess ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> :
              <Sparkles className="h-4 w-4 text-zinc-700 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <div className={cls(
                'font-mono text-[10px] uppercase tracking-[0.2em] font-bold mb-0.5',
                isError ? 'text-red-600' : isSuccess ? 'text-emerald-600' : 'text-zinc-700'
              )}>
                {isError ? 'Error' : isSuccess ? 'Success' : 'Info'}
              </div>
              <div className="font-mono text-[12px] text-zinc-900 break-words">{t.message}</div>
            </div>
            <button onClick={() => dismiss(t.id)} className="text-zinc-400 hover:text-zinc-900 shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN APP
   ════════════════════════════════════════════════════════════════════════ */

export default function App() {
  const [data, setData] = useState(() => loadLocalData());
  const [view, setView] = useState('dashboard');
  const [syncing, setSyncing] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [time, setTime] = useState(new Date());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  // On every device, first try to hydrate from the deployed data.json.
  // This is the missing piece: localStorage is device-only, but data.json is shared.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const remote = await loadPublicData();
      if (!remote || cancelled) return;

      setData((current) => {
        const normalizedRemote = normalizeAppData(remote, {
          githubToken: current.settings.githubToken,
          githubRepo: current.settings.githubRepo || remote.settings?.githubRepo || '',
        });

        return shouldUseRemoteData(normalizedRemote, current) ? normalizedRemote : current;
      });
    })();

    return () => { cancelled = true; };
  }, []);

  // Persist every state change locally so refreshes and manual GitHub pulls keep data visible.
  useEffect(() => {
    saveLocalData(data);
  }, [data]);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const showToast = useCallback((message, type = 'info') => {
    const id = uid();
    setToasts((ts) => [...ts, { id, message, type }]);
    setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = (id) => setToasts((ts) => ts.filter((t) => t.id !== id));

  const updateSettings = (patch) => {
    setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  };

  /* ───── GitHub sync ───── */

  const pushToGitHub = useCallback(async () => {
    const token = data.settings.githubToken?.trim();
    const repo = data.settings.githubRepo?.trim();

    if (!token || !repo) {
      showToast('Set GitHub token and repo first', 'error');
      return;
    }

    setSyncing(true);
    const syncedAt = new Date().toISOString();

    try {
      let sha;
      const metaRes = await fetch(`${ghUrl(repo)}?t=${Date.now()}`, {
        headers: ghHeaders(token),
        cache: 'no-store',
      });

      if (metaRes.ok) {
        const meta = await metaRes.json();
        sha = meta.sha;
      } else if (metaRes.status !== 404) {
        const err = await metaRes.json().catch(() => ({}));
        throw new Error(err.message || `GET failed: HTTP ${metaRes.status}`);
      }

      const dataToSave = stripGithubToken({
        ...data,
        settings: {
          ...(data.settings || {}),
          lastSync: syncedAt,
        },
      });

      const body = {
        message: `Sync ${syncedAt}`,
        content: utf8ToBase64(JSON.stringify(dataToSave, null, 2)),
        ...(sha ? { sha } : {}),
      };

      const putRes = await fetch(ghUrl(repo), {
        method: 'PUT',
        headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!putRes.ok) {
        const err = await putRes.json().catch(() => ({}));
        throw new Error(err.message || `PUT failed: HTTP ${putRes.status}`);
      }

      setData((prev) => normalizeAppData(
        { ...prev, settings: { ...prev.settings, lastSync: syncedAt } },
        { githubToken: token, githubRepo: repo }
      ));
      showToast('Synced to GitHub. Other devices update after GitHub Pages rebuild/refresh.', 'success');
    } catch (e) {
      showToast(`Sync failed: ${e.message}`, 'error');
    } finally {
      setSyncing(false);
    }
  }, [data, showToast]);

  const pullFromGitHub = useCallback(async () => {
    const token = data.settings.githubToken?.trim();
    const repo = data.settings.githubRepo?.trim();

    if (!token || !repo) {
      showToast('Set GitHub token and repo first', 'error');
      return;
    }

    setSyncing(true);
    try {
      const res = await fetch(`${ghUrl(repo)}?t=${Date.now()}`, {
        headers: ghHeaders(token),
        cache: 'no-store',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }

      const file = await res.json();
      const loaded = JSON.parse(base64ToUtf8(file.content));
      const syncedAt = new Date().toISOString();

      setData((prev) => normalizeAppData(
        {
          ...loaded,
          settings: {
            ...(loaded.settings || {}),
            lastSync: syncedAt,
          },
        },
        {
          githubToken: prev.settings.githubToken,
          githubRepo: prev.settings.githubRepo,
        }
      ));

      showToast('Data synced from GitHub', 'success');
    } catch (e) {
      showToast('Pull failed: ' + e.message, 'error');
    } finally {
      setSyncing(false);
    }
  }, [data.settings.githubToken, data.settings.githubRepo, showToast]);

  /* ───── Global keyboard shortcuts ───── */

  useEffect(() => {
    const handler = (e) => {
      const target = e.target;
      const inInput = target && target.matches && target.matches('input, textarea, select, [contenteditable="true"]');

      // ⌘K / Ctrl+K — command palette (works everywhere)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      // ⌘S / Ctrl+S — sync
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        pushToGitHub();
        return;
      }

      // ⌘E / Ctrl+E — export
      if ((e.metaKey || e.ctrlKey) && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }

      // Skip the rest if user is typing
      if (inInput) return;

      // Esc — close any modal
      if (e.key === 'Escape') {
        if (paletteOpen) setPaletteOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (helpOpen) setHelpOpen(false);
        return;
      }

      // Number keys — switch view
      if (e.key >= '1' && e.key <= '6') {
        const viewMap = ['dashboard', 'nova', 'jobs', 'habits', 'finance', 'general'];
        setView(viewMap[parseInt(e.key) - 1]);
        return;
      }

      // ? — help
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      // / — focus palette
      if (e.key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paletteOpen, settingsOpen, helpOpen, pushToGitHub]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans relative overflow-hidden">
      {/* Subtle dot grid — blueprint texture */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(24,24,27,0.08) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          backgroundPosition: '0 0',
        }}
      />
      {/* Soft emerald halo from top */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(16,185,129,0.08) 0%, transparent 60%)',
        }}
      />
      {/* Subtle paper warmth */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.4) 0%, transparent 30%, transparent 70%, rgba(244,244,245,0.5) 100%)',
        }}
      />

      <div className="relative">
        <StatusBar time={time} lastSync={data.settings.lastSync} syncing={syncing} openPalette={() => setPaletteOpen(true)} />
        <Header
          view={view}
          setView={setView}
          data={data}
          updateSettings={updateSettings}
          pushGh={pushToGitHub}
          pullGh={pullFromGitHub}
          syncing={syncing}
          openSettings={() => setSettingsOpen(true)}
          openHelp={() => setHelpOpen(true)}
        />

        <main className="relative">
          {view === 'dashboard' && <Dashboard data={data} setView={setView} setData={setData} showToast={showToast} openPalette={() => setPaletteOpen(true)} />}
          {view === 'nova' && <Nova data={data} setData={setData} showToast={showToast} />}
          {view === 'jobs' && <Jobs data={data} setData={setData} showToast={showToast} />}
          {view === 'habits' && <Habits data={data} setData={setData} showToast={showToast} />}
          {view === 'finance' && <Finance data={data} setData={setData} showToast={showToast} openBulkImport={() => setBulkImportOpen(true)} />}
          {view === 'general' && <GeneralTasks data={data} setData={setData} showToast={showToast} />}
        </main>

        <footer className="mx-auto max-w-[1400px] px-5 py-6 border-t border-zinc-200 mt-8">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            <div className="flex items-center gap-3">
              <span>life_os.protocol // build 8.0.0</span>
              <span className="hidden sm:flex items-center gap-1.5 text-zinc-500">
                <KbdKey>?</KbdKey> shortcuts
                <KbdKey className="ml-2">⌘</KbdKey><KbdKey>K</KbdKey> search
              </span>
            </div>
            <span className="flex items-center gap-2">
              <NeonDot />
              {data.settings.lastSync
                ? `last sync ${new Date(data.settings.lastSync).toLocaleString('en-GB')}`
                : 'not yet synced'}
            </span>
          </div>
        </footer>
      </div>

      {/* Modals & overlays */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        data={data}
        setView={setView}
        setData={setData}
        showToast={showToast}
        openSettings={() => setSettingsOpen(true)}
        openHelp={() => setHelpOpen(true)}
        pushGh={pushToGitHub}
        pullGh={pullFromGitHub}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        data={data}
        setData={setData}
        showToast={showToast}
      />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <BulkImportModal open={bulkImportOpen} onClose={() => setBulkImportOpen(false)} setData={setData} showToast={showToast} monthHint={getMonthKey()} cur={data.finance.currency || 'UAH'} />

      <Toasts toasts={toasts} dismiss={dismissToast} />

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes slideDown {
          from { transform: translateY(-8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        ::selection { background: rgba(16, 185, 129, 0.25); color: #064e3b; }
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { scrollbar-width: none; }
      `}</style>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   AUTO-MOUNT — for direct browser loading via index.html + Babel standalone.
   Safe to leave in place if you later switch to a bundler (Vite/Webpack) —
   it's a no-op when there's no #root element or App is already mounted.
   ════════════════════════════════════════════════════════════════════════ */

if (typeof document !== 'undefined') {
  const __rootEl = document.getElementById('root');
  if (__rootEl && !__rootEl.__lifeOsMounted) {
    __rootEl.__lifeOsMounted = true;
    createRoot(__rootEl).render(<App />);
  }
}
