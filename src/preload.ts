import { contextBridge, ipcRenderer } from 'electron';
import type { RoboratoryApi } from './shared/api';

const call = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args);
const on = (ch: string) => (cb: (p: any) => void) => {
  const h = (_e: unknown, p: unknown) => cb(p);
  ipcRenderer.on(ch, h);
  return () => { ipcRenderer.removeListener(ch, h); };
};

const api: RoboratoryApi = {
  state: call('state') as RoboratoryApi['state'],
  engineStart: call('engineStart') as RoboratoryApi['engineStart'],
  engineRestartWhenIdle: call('engineRestartWhenIdle') as RoboratoryApi['engineRestartWhenIdle'],
  onEngine: on('engine'),
  openFactory: call('openFactory') as RoboratoryApi['openFactory'],
  openFactoryAt: call('openFactoryAt') as RoboratoryApi['openFactoryAt'],
  createDemo: call('createDemo') as RoboratoryApi['createDemo'],
  closeFactory: call('closeFactory') as RoboratoryApi['closeFactory'],
  run: call('run') as RoboratoryApi['run'],
  retry: call('retry') as RoboratoryApi['retry'],
  release: call('release') as RoboratoryApi['release'],
  answer: call('answer') as RoboratoryApi['answer'],
  halt: call('halt') as RoboratoryApi['halt'],
  resume: call('resume') as RoboratoryApi['resume'],
  runs: call('runs') as RoboratoryApi['runs'],
  runDetail: call('runDetail') as RoboratoryApi['runDetail'],
  ask: call('ask') as RoboratoryApi['ask'],
  messages: call('messages') as RoboratoryApi['messages'],
  acceptProposal: call('acceptProposal') as RoboratoryApi['acceptProposal'],
  rejectProposal: call('rejectProposal') as RoboratoryApi['rejectProposal'],
  reveal: call('reveal') as RoboratoryApi['reveal'],
  buildStart: call('buildStart') as RoboratoryApi['buildStart'],
  buildApply: call('buildApply') as RoboratoryApi['buildApply'],
  buildUndo: call('buildUndo') as RoboratoryApi['buildUndo'],
  buildRedo: call('buildRedo') as RoboratoryApi['buildRedo'],
  buildFields: call('buildFields') as RoboratoryApi['buildFields'],
  buildServers: call('buildServers') as RoboratoryApi['buildServers'],
  buildRead: call('buildRead') as RoboratoryApi['buildRead'],
  buildList: call('buildList') as RoboratoryApi['buildList'],
  buildSave: call('buildSave') as RoboratoryApi['buildSave'],
  buildDiscard: call('buildDiscard') as RoboratoryApi['buildDiscard'],
  onBuild: on('build'),
  onSnapshot: on('snapshot'),
  onLogs: on('logs'),
  onMessages: on('messages'),
};

contextBridge.exposeInMainWorld('roboratory', api);
