import { contextBridge, ipcRenderer } from 'electron';
import type { PromptoryApi } from './shared/api';

const call = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args);
const on = (ch: string) => (cb: (p: any) => void) => {
  const h = (_e: unknown, p: unknown) => cb(p);
  ipcRenderer.on(ch, h);
  return () => { ipcRenderer.removeListener(ch, h); };
};

const api: PromptoryApi = {
  state: call('state') as PromptoryApi['state'],
  openFactory: call('openFactory') as PromptoryApi['openFactory'],
  openFactoryAt: call('openFactoryAt') as PromptoryApi['openFactoryAt'],
  createDemo: call('createDemo') as PromptoryApi['createDemo'],
  closeFactory: call('closeFactory') as PromptoryApi['closeFactory'],
  run: call('run') as PromptoryApi['run'],
  retry: call('retry') as PromptoryApi['retry'],
  release: call('release') as PromptoryApi['release'],
  answer: call('answer') as PromptoryApi['answer'],
  halt: call('halt') as PromptoryApi['halt'],
  resume: call('resume') as PromptoryApi['resume'],
  runs: call('runs') as PromptoryApi['runs'],
  runDetail: call('runDetail') as PromptoryApi['runDetail'],
  ask: call('ask') as PromptoryApi['ask'],
  messages: call('messages') as PromptoryApi['messages'],
  acceptProposal: call('acceptProposal') as PromptoryApi['acceptProposal'],
  rejectProposal: call('rejectProposal') as PromptoryApi['rejectProposal'],
  reveal: call('reveal') as PromptoryApi['reveal'],
  buildStart: call('buildStart') as PromptoryApi['buildStart'],
  buildApply: call('buildApply') as PromptoryApi['buildApply'],
  buildUndo: call('buildUndo') as PromptoryApi['buildUndo'],
  buildRedo: call('buildRedo') as PromptoryApi['buildRedo'],
  buildFields: call('buildFields') as PromptoryApi['buildFields'],
  buildServers: call('buildServers') as PromptoryApi['buildServers'],
  buildRead: call('buildRead') as PromptoryApi['buildRead'],
  buildList: call('buildList') as PromptoryApi['buildList'],
  buildSave: call('buildSave') as PromptoryApi['buildSave'],
  buildDiscard: call('buildDiscard') as PromptoryApi['buildDiscard'],
  onBuild: on('build'),
  onSnapshot: on('snapshot'),
  onLogs: on('logs'),
  onMessages: on('messages'),
};

contextBridge.exposeInMainWorld('promptory', api);
