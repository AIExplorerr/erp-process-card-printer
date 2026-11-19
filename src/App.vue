<script setup lang="ts">
import { bitable, FieldType, ToastType } from '@lark-base-open/js-sdk';
import { computed, nextTick, onBeforeMount, onBeforeUnmount, ref, watch } from 'vue';
import usePrint from './hooks/usePrint';
import { confirmPrintedRecords, getPrintHistory } from './hooks/usePrintStatus';
import type { PrintHistoryRecord } from './hooks/usePrintStatus';
import { getOperatorStorageKey, printOperatorId } from './hooks/usePrint';

const {
  selectRecord,
  addRecordIds,
  retainSelectedRecords,
  clearSelection,
  init,
  handleSetting,
  handleSettingListUpdate,
  currentRecords,
  selectedRecordIds,
  selectedRecordLabels,
  loadProgress,
  restoreNotice,
  isLoading,
  isSettingPanelShow,
  settingList
} = usePrint();

// Active selection and Feishu-backed print history are separate views.
const activeTab = ref<'current' | 'history'>('current');
const historyRecords = ref<PrintHistoryRecord[]>([]);
const historyLoading = ref(false);
const historyError = ref('');
const historyGroups = computed(() => {
  const groups = new Map<string, PrintHistoryRecord[]>();
  for (const record of historyRecords.value) {
    const key = new Date(record.time).toLocaleDateString('zh-CN');
    const current = groups.get(key) ?? [];
    current.push(record);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([date, records]) => ({ date, records }));
});
const refreshHistory = async () => {
  if (historyLoading.value) return;
  historyLoading.value = true;
  historyError.value = '';
  try { historyRecords.value = await getPrintHistory(); }
  catch (e) { historyError.value = e instanceof Error ? e.message : String(e); }
  finally { historyLoading.value = false; }
};
const setActiveTab = (name: 'current' | 'history') => {
  activeTab.value = name;
  if (name === 'history') void refreshHistory();
};
const restoreFromHistory = async (ids: string[]) => {
  if (isLoading.value || pendingJobId.value || finishBusy.value) return;
  await addRecordIds(ids);
  activeTab.value = 'current';
};
const prettyTime = (stamp: number) => stamp ? new Date(stamp).toLocaleString('zh-CN', { hour12: false }) : '时间未记录';

const isManagePanelShow = ref(false);
const isClearConfirmShow = ref(false);
// Remove is immediate, unlike the old keep-checkbox design.
const removeFromBatch = (id: string) => {
  if (pendingJobId.value || finishBusy.value) return;
  retainSelectedRecords(selectedRecordIds.value.filter(item => item !== id));
  managedRecordIds.value = managedRecordIds.value.filter(item => item !== id);
};
const pendingPrintIds = ref<string[]>([]);
const completedPrintIds = ref<string[]>([]);
const pendingJobId = ref('');
const PENDING_KEY = 'erp_pending_print_confirmation_v2';
const operatorIdentity = computed(() => printOperatorId.value || '用户身份读取中');
const pendingRestored = ref(false);
const hadWriteAttempt = ref(false);
const pendingSaveError = ref('');
type PendingJob = { jobId: string; recordIds: string[]; selectedIds: string[]; hadWriteAttempt: boolean };
const storePendingJob = async () => {
  const pending: PendingJob = pendingJobId.value && pendingPrintIds.value.length
    ? { jobId: pendingJobId.value, recordIds: [...pendingPrintIds.value], selectedIds: [...completedPrintIds.value], hadWriteAttempt: hadWriteAttempt.value }
    : { jobId: '', recordIds: [], selectedIds: [], hadWriteAttempt: false };
  const ok = await bitable.bridge.setData(getOperatorStorageKey(PENDING_KEY), pending);
  if (ok === false) throw new Error('打印确认任务未能保存，暂不能继续');
};
const recoverPendingJob = async () => {
  try {
    const saved = await bitable.bridge.getData<PendingJob>(getOperatorStorageKey(PENDING_KEY));
    if (!saved || !saved.jobId || !Array.isArray(saved.recordIds) || !saved.recordIds.length) return;
    // Show a manual confirmation rather than assuming a recovered preview was actually printed.
    pendingJobId.value = saved.jobId;
    pendingPrintIds.value = [...new Set(saved.recordIds)];
    completedPrintIds.value = Array.isArray(saved.selectedIds) ? saved.selectedIds.filter(id=>pendingPrintIds.value.includes(id)) : [];
    hadWriteAttempt.value = saved.hadWriteAttempt === true;
    pendingRestored.value = true;
    showFinishDialog.value = true;
  } catch (error) { pendingSaveError.value = error instanceof Error ? error.message : String(error); }
};
const showFinishDialog = ref(false);
const finishBusy = ref(false);
const finishErrors = ref<string[]>([]);
const onPrintPreviewClosed = () => {
  resetPrintMode();
  if (pendingPrintIds.value.length) { completedPrintIds.value = []; showFinishDialog.value = true; }
};
const keepUnfinishedBatch = async () => {
  if (finishBusy.value || hadWriteAttempt.value) return;
  try {
    const ok = await bitable.bridge.setData(getOperatorStorageKey(PENDING_KEY), { jobId: '', recordIds: [], selectedIds: [], hadWriteAttempt: false } satisfies PendingJob);
    if (ok === false) throw new Error('无法清除未完成确认任务');
  }
  catch(e){ pendingSaveError.value = String(e); return; }
  showFinishDialog.value = false;
  pendingPrintIds.value = [];
  completedPrintIds.value = [];
  pendingJobId.value = '';
  finishErrors.value = [];
  hadWriteAttempt.value = false;
  pendingRestored.value = false;
};
const confirmFinishedPrinting = async () => {
  if (finishBusy.value || !completedPrintIds.value.length || !pendingJobId.value) return;
  finishBusy.value = true;
  finishErrors.value = [];
  hadWriteAttempt.value = true;
  try { await storePendingJob(); }
  catch(e) { finishErrors.value = [String(e)]; finishBusy.value = false; return; }
  const printed = [...completedPrintIds.value];
  const labels = new Map(selectedRecordLabels.value.map(x => [x.id,x.label]));
  try {
    const result = await confirmPrintedRecords(printed, pendingJobId.value, printOperatorId.value);
    const ok = new Set(result.success);
    if (ok.size) retainSelectedRecords(selectedRecordIds.value.filter(id => !ok.has(id)));
    pendingPrintIds.value = pendingPrintIds.value.filter(id => !ok.has(id));
    completedPrintIds.value = result.failed.map(item => item.id);
    finishErrors.value = result.failed.map(item => `${labels.get(item.id) ?? item.id}: ${item.reason}`);
    try { await storePendingJob(); } catch(e) { finishErrors.value.push(`保存恢复信息失败：${String(e)}`); }
    if (!result.failed.length) {
      showFinishDialog.value = false;
      pendingPrintIds.value = [];
      completedPrintIds.value = [];
      pendingJobId.value = '';
      try { await storePendingJob(); } catch(e) { pendingSaveError.value = String(e); }
      pendingRestored.value = false;
      hadWriteAttempt.value = false;
      void refreshHistory();
      bitable.ui.showToast({ toastType: ToastType.success, message: `已同步 ${ok.size} 条记录并写入打印日志` });
    }
  } catch (e) { finishErrors.value = [e instanceof Error ? e.message : String(e)]; }
  finally { finishBusy.value = false; }
};
const managedRecordIds = ref<string[]>([]);
const batchGroups = computed(() => {
  const groups = new Map<string, number>();
  for (const record of selectedRecordLabels.value) {
    const label = record.label;
    const group = label.includes('#') ? label.slice(0, label.lastIndexOf('#')) : '(未分类)';
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  return [...groups.entries()].map(([name, count]) => ({name, count}));
});
const missingIdentifierItems = computed(() => printItems.value.filter(item => /^记录 \d+$/.test(item.label)));

const isPrintConfirmShow = ref(false);
const printInProgress = ref(false);
const printValidOnly = ref(false);

const openManagePanel = () => {
  managedRecordIds.value = [...selectedRecordIds.value];
  isManagePanelShow.value = true;
};
const confirmClearSelection = () => {
  if (pendingJobId.value || finishBusy.value) return;
  clearSelection();
  managedRecordIds.value = [];
  isManagePanelShow.value = false;
  isClearConfirmShow.value = false;
};

// Find the attachment that is actually printed on each process card.
// Checking by field name avoids mistaking unrelated attachments for the QR code.
const QR_FIELD_NAME = '工艺卡二维码';
const printItems = computed(() => currentRecords.value.map((fields, index) => {
  const qr = fields.find(field => field.name === QR_FIELD_NAME && field.type === FieldType.Attachment);
  const urls: string[] = Array.isArray(qr?.value)
    ? qr.value.filter((url: unknown): url is string => typeof url === 'string' && url.trim().length > 0)
    : [];
  return {
    id: selectedRecordIds.value[index] ?? `record-${index}`,
    label: selectedRecordLabels.value[index]?.label ?? `记录 ${index + 1}`,
    fields,
    hasQr: urls.length > 0,
    qrUrls: urls
  };
}));

const missingQrItems = computed(() => printItems.value.filter(item => !item.hasQr));
const completeQrItems = computed(() => printItems.value.filter(item => item.hasQr));
const printOrderCount = computed(() => new Set(
  printItems.value.map(item => item.label.includes('#')
    ? item.label.slice(0, item.label.lastIndexOf('#')).trim()
    : item.label.trim())
).size);

// Normally show all cards. Only reduce the rendered set when explicitly printing
// the complete-QR subset. This keeps page breaks correct, with no blank end page.
const visiblePrintItems = computed(() => printValidOnly.value
  ? completeQrItems.value
  : printItems.value);

const openPrintConfirmation = () => {
  if (isLoading.value || printInProgress.value || pendingPrintIds.value.length || pendingSaveError.value || !printItems.value.length) return;
  isPrintConfirmShow.value = true;
};

const resetPrintMode = () => {
  printInProgress.value = false;
  printValidOnly.value = false;
};

const runPrint = async (onlyValid: boolean) => {
  if (printInProgress.value) return;
  if (onlyValid && !completeQrItems.value.length) return;
  if (!onlyValid && (missingQrItems.value.length || missingIdentifierItems.value.length)) return;
  if (onlyValid && completeQrItems.value.some(item => /^记录 \d+$/.test(item.label))) return;

  isPrintConfirmShow.value = false;
  printInProgress.value = true;
  printValidOnly.value = onlyValid;
  await nextTick();

  // QR URLs may be valid while images are still loading. Wait for the actual
  // displayed images to finish before opening the print preview.
  const images = Array.from(document.querySelectorAll<HTMLImageElement>('#my-print-container .qr-image'));
  const loaded = await Promise.all(images.map(img => {
    if (img.complete) return Promise.resolve(img.naturalWidth > 0);
    return new Promise<boolean>(resolve => {
      const done = (ok: boolean) => resolve(ok);
      img.addEventListener('load', () => done(true), { once: true });
      img.addEventListener('error', () => done(false), { once: true });
      setTimeout(() => done(false), 12000);
    });
  }));

  if (loaded.some(ok => !ok)) {
    resetPrintMode();
    bitable.ui.showToast({ toastType: ToastType.error, message: '部分二维码图片未能加载，请检查后重试' });
    return;
  }

  // Record exactly the cards submitted to the print preview, not every selected card.
  pendingPrintIds.value = visiblePrintItems.value.map(item => item.id);
  pendingJobId.value = `job-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  finishErrors.value = [];
  completedPrintIds.value = []; // Restored previews are never assumed physically printed.
  hadWriteAttempt.value = false;
  try { await storePendingJob(); }
  catch(e) { pendingSaveError.value = String(e); pendingPrintIds.value = []; pendingJobId.value = ''; resetPrintMode(); return; }
  // afterprint cannot prove a physical print. Only explicit confirmation writes Feishu data.
  try { window.print(); }
  catch (error) {
    pendingPrintIds.value = [];
    pendingJobId.value = '';
    try { await storePendingJob(); } catch(e) { pendingSaveError.value = String(e); }
    resetPrintMode();
    bitable.ui.showToast({ toastType: ToastType.error, message: '无法打开打印预览，请重试' });
  }
};

onBeforeMount(async () => {
  window.addEventListener('afterprint', onPrintPreviewClosed);
  await init();
  await recoverPendingJob();
  try {
    const saved = await bitable.bridge.getData<{
      fontSize?: number; cellPadding?: number; labelWidth?: number; qrSize?: number;
    }>('erp_process_card_layout_v1');
    if (saved) {
      layout.value = {
        fontSize: saved.fontSize ?? 9,
        cellPadding: saved.cellPadding ?? 1.5,
        labelWidth: saved.labelWidth ?? 32,
        qrSize: saved.qrSize ?? 20
      };
    }
  } catch (error) {
    console.error('Failed to load layout settings:', error);
  }
});
onBeforeUnmount(() => window.removeEventListener('afterprint', onPrintPreviewClosed));

const LAYOUT_KEY = 'erp_process_card_layout_v1';
const layout = ref({ fontSize: 9, cellPadding: 1.5, labelWidth: 32, qrSize: 20 });
watch(layout, async value => {
  try { await bitable.bridge.setData(LAYOUT_KEY, { ...value }); }
  catch (error) { console.error('Failed to save layout settings:', error); }
}, { deep: true });
</script>

<template>
  <div class="workspace-switcher">
    <el-button :type="activeTab === 'current' ? 'primary' : 'default'" @click="setActiveTab('current')">当前批次 ({{ currentRecords.length }})</el-button>
    <el-button :type="activeTab === 'history' ? 'primary' : 'default'" @click="setActiveTab('history')">打印历史</el-button>
  </div>
  <div v-if="activeTab === 'current'" class="my-tools-container">
    <el-button :loading="isLoading" :disabled="printInProgress || finishBusy || !!pendingJobId || !!pendingSaveError" @click="selectRecord">添加记录</el-button>
    <el-button :disabled="isLoading || printInProgress || !!pendingJobId || !!pendingSaveError || !currentRecords.length" @click="openManagePanel">管理已选 ({{ currentRecords.length }})</el-button>
    <el-button :disabled="isLoading || printInProgress || !!pendingJobId || !!pendingSaveError || !currentRecords.length" @click="openPrintConfirmation">打印</el-button>
    <el-button :disabled="isLoading || printInProgress" @click="handleSetting">设置</el-button>
    <el-button v-if="pendingPrintIds.length" type="warning" @click="showFinishDialog = true">确认打印结果 ({{ pendingPrintIds.length }})</el-button>
    <el-alert v-if="pendingSaveError && !showFinishDialog" :title="pendingSaveError" type="error" :closable="false" />
    <span v-if="currentRecords.length" class="card-count">已选 {{ currentRecords.length }} 张 · {{ batchGroups.length }} 组 · 预计 {{ currentRecords.length }} 页</span>
    <span v-if="isLoading" class="card-count">读取中 {{ loadProgress.done }}/{{ loadProgress.total }}</span>
    <span v-else-if="restoreNotice" class="card-count">{{ restoreNotice }}</span>
  </div>
  <section v-else class="history-panel">
    <div class="history-toolbar"><strong>已确认打印记录</strong><el-button :loading="historyLoading" @click="refreshHistory">刷新</el-button></div>
    <el-alert v-if="historyError" :title="historyError" type="error" :closable="false" />
    <p class="history-note">从飞书「工艺卡打印记录表」读取每次已确认的打印记录，包括首次打印与重新打印。</p>
    <p v-if="!historyLoading && !historyGroups.length">暂无已确认打印的记录。</p>
    <div v-for="group in historyGroups" :key="group.date" class="history-group">
      <div class="history-group-heading"><strong>{{ group.date }}</strong> · {{ group.records.length }} 张</div>
      <div v-for="item in group.records" :key="item.id" class="history-record">
        <span>{{ item.label }} <small>{{ item.kind }} · {{ prettyTime(item.time) }}</small></span>
        <el-button size="small" :disabled="!item.unitId" @click="restoreFromHistory([item.unitId])">重新加入</el-button>
      </div>
      <el-button size="small" plain @click="restoreFromHistory(group.records.map(item => item.unitId).filter(Boolean))">本日记录重新加入批次</el-button>
    </div>
  </section>

  <!-- The user must explicitly confirm which cards were physically printed successfully. -->
  <el-dialog v-model="showFinishDialog" title="确认实际打印结果" width="min(520px, calc(100vw - 24px))" append-to-body :close-on-click-modal="false" :close-on-press-escape="false" :show-close="false">
    <p>本次提交 {{ pendingPrintIds.length }} 张。请勾选实际打印成功的记录；未勾选的继续保留在当前批次。</p>
    <div class="finish-checklist">
      <el-checkbox-group v-model="completedPrintIds">
        <el-checkbox v-for="id in pendingPrintIds" :key="id" :value="id" style="display:block;margin:5px 0">
          {{ selectedRecordLabels.find(x=>x.id===id)?.label ?? id }}
        </el-checkbox>
      </el-checkbox-group>
    </div>
    <p class="manage-hint">当前飞书操作员 ID：{{ operatorIdentity }}（自动记录到日志备注）</p>
    <el-alert v-if="pendingRestored" type="warning" title="已恢复上次未完成的打印确认，请仅勾选实际成功打印的卡" :closable="false" />
    <el-alert v-if="pendingSaveError" type="error" :title="pendingSaveError" :closable="false" />
    <el-alert v-if="hadWriteAttempt" type="info" title="已尝试写入飞书；为避免重复记录，无法直接丢弃本次任务。请重试同步或联系管理员核对日志。" :closable="false" />
    <el-alert v-if="finishErrors.length" title="部分记录同步失败；同一批次可安全重试" :closable="false" type="error" style="margin-top:10px">
      <div v-for="error in finishErrors" :key="error">{{ error }}</div>
    </el-alert>
    <template #footer>
      <el-button :disabled="finishBusy || hadWriteAttempt" @click="keepUnfinishedBatch">未完成，全部保留</el-button>
      <el-button type="primary" :disabled="!completedPrintIds.length" :loading="finishBusy" @click="confirmFinishedPrinting">确认 {{ completedPrintIds.length }} 张并同步飞书</el-button>
    </template>
  </el-dialog>
  <el-dialog v-model="isClearConfirmShow" title="清空当前批次？" width="min(440px, calc(100vw - 24px))" append-to-body>
    <p>这将移除当前批次的全部记录，不会删除飞书表格中的任何记录，也不会清除打印历史。</p>
    <template #footer><el-button @click="isClearConfirmShow = false">取消</el-button><el-button type="danger" @click="confirmClearSelection">确认清空当前批次</el-button></template>
  </el-dialog>

  <el-dialog
    v-model="isPrintConfirmShow"
    title="打印前确认"
    width="min(520px, calc(100vw - 24px))"
    top="5vh"
    append-to-body
    class="print-confirm-dialog"
  >
    <p>当前选择 <strong>{{ printItems.length }}</strong> 张工艺卡，涉及 <strong>{{ printOrderCount }}</strong> 个编号组。</p>
    <p>已按周转单位编号自动排序。纸张尺寸：<strong>100 × 150 mm</strong>，每张工艺卡独占一页。</p>
    <el-alert
      v-if="missingIdentifierItems.length"
      title="部分记录缺少周转单位编号"
      type="error"
      :closable="false"
      show-icon
      class="identifier-warning"
    >
      <div>请先检查以下记录的周转单位编号，避免打印后无法识别：</div>
      <ul><li v-for="item in missingIdentifierItems" :key="item.id">{{ item.label }}（{{ item.id }}）</li></ul>
    </el-alert>
    <el-alert
      v-if="missingQrItems.length"
      title="发现缺少工艺卡二维码的记录"
      type="warning"
      :closable="false"
      show-icon
    >
      <div>共 {{ missingQrItems.length }} 条缺少可用的二维码附件链接：</div>
      <ul class="qr-warning-list">
        <li v-for="item in missingQrItems" :key="item.id">{{ item.label }}</li>
      </ul>
      <div>请返回飞书补齐二维码，或仅打印其余 {{ completeQrItems.length }} 张记录。</div>
    </el-alert>
    <el-alert v-else title="二维码附件检查通过" type="success" :closable="false" show-icon>
      {{ printItems.length }} 条记录均有工艺卡二维码附件链接；打印前仍会检查图片是否加载成功。
    </el-alert>
    <template #footer>
      <el-button @click="isPrintConfirmShow = false">取消</el-button>
      <el-button
        v-if="missingQrItems.length"
        type="primary"
        :disabled="!completeQrItems.length || missingIdentifierItems.length > 0"
        @click="runPrint(true)"
      >仅打印完整记录 ({{ completeQrItems.length }})</el-button>
      <el-button v-else type="primary" :disabled="missingIdentifierItems.length > 0" @click="runPrint(false)">确认打印 ({{ printItems.length }})</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="isManagePanelShow"
    title="管理已选记录"
    width="min(600px, calc(100vw - 24px))"
    top="5vh"
    append-to-body
    class="manage-records-dialog"
  >
    <p class="manage-hint">已按周转单位编号自动排序（工单编号 → #后数字）。此列表顺序即最终打印顺序。</p>
    <p class="manage-hint">点击「移除」即可从当前批次移除单条记录，不会删除飞书原始记录。</p>
    <div class="manage-summary">当前批次 {{ selectedRecordIds.length }} 条 · {{ batchGroups.length }} 组</div>
    <div class="batch-group-summary"><span v-for="group in batchGroups" :key="group.name">{{ group.name }}：{{ group.count }} 张</span></div>
    <div class="managed-record-list">
      <div v-for="(record, index) in selectedRecordLabels" :key="record.id" class="managed-row">
        <span>{{ index + 1 }}. {{ record.label }}</span>
        <el-button size="small" type="danger" plain @click="removeFromBatch(record.id)">移除</el-button>
      </div>
    </div>
    <template #footer><div class="manage-actions">
      <el-button type="danger" plain @click="isClearConfirmShow = true">清空当前批次</el-button>
      <span class="manage-action-spacer"></span>
      <el-button type="primary" @click="isManagePanelShow = false">完成</el-button>
    </div></template>
  </el-dialog>

  <el-dialog
    v-model="isSettingPanelShow"
    title="工艺卡打印设置"
    width="min(600px, calc(100vw - 24px))"
    top="5vh"
    class="print-settings-dialog"
    append-to-body
  >
    <el-tabs model-value="fields">
      <el-tab-pane label="字段设置" name="fields">
        <settings-panel :list="settingList" @update:list="handleSettingListUpdate" />
      </el-tab-pane>
      <el-tab-pane label="排版设置" name="layout">
        <el-form label-position="top">
          <el-form-item label="字体大小 (pt)">
            <el-slider v-model="layout.fontSize" :min="7" :max="13" :step="0.5" show-input />
          </el-form-item>
          <el-form-item label="上下间距 (mm)">
            <el-slider v-model="layout.cellPadding" :min="0.5" :max="4" :step="0.5" show-input />
          </el-form-item>
          <el-form-item label="字段名称列宽 (%)">
            <el-slider v-model="layout.labelWidth" :min="15" :max="65" :step="1" show-input />
          </el-form-item>
          <el-form-item label="二维码尺寸 (mm)">
            <el-slider v-model="layout.qrSize" :min="15" :max="30" :step="1" show-input />
          </el-form-item>
          <el-divider />
          <div class="layout-description">
            <p>纸张尺寸：100 × 150 mm</p>
            <p>每条记录打印为独立的一页。</p>
            <p>设置会自动保存。</p>
          </div>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>

  <div v-if="currentRecords.length" v-show="activeTab === 'current'" id="my-print-container">
    <div
      v-for="item in visiblePrintItems"
      :key="item.id"
      class="print-sheet"
      :style="{
        '--card-font-size': layout.fontSize + 'pt',
        '--card-cell-padding': layout.cellPadding + 'mm',
        '--card-label-width': layout.labelWidth + '%',
        '--card-qr-size': layout.qrSize + 'mm'
      }"
    >
      <div class="my-grid-table">
        <div v-for="field in item.fields" :key="field.id" class="my-grid-row">
          <div class="my-grid-cell label-cell">{{ field.name }}</div>
          <div class="my-grid-cell value-cell">
            <template v-if="field.type === FieldType.Attachment">
              <img
                v-for="(url, imageIndex) in field.value"
                :key="imageIndex"
                :src="url"
                class="qr-image"
                alt="附件图片"
              />
            </template>
            <template v-else>{{ field.value }}</template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workspace-switcher { display: flex; gap: 8px; flex-wrap: wrap; padding: 8px 4px; }
.workspace-switcher :deep(.el-button + .el-button) { margin-left: 0; }
.history-panel { padding: 10px; font-size: 13px; }
.history-toolbar { display: flex; justify-content: space-between; align-items: center; }
.history-note { color: #606266; line-height: 1.5; }
.history-group { border: 1px solid #ddd; padding: 10px; margin: 10px 0; }
.history-group-heading { margin-bottom: 8px; }
.history-record { display: flex; gap: 6px; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #eee; }
.history-record small { color: #888; }
.managed-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px; border-bottom: 1px solid #e5e7eb; }
.managed-row span { min-width: 0; overflow-wrap: anywhere; }
.error-list { color: #c45656; max-height: 140px; overflow-y: auto; }
.card-count { font-size: 12px; color: #606266; }
.manage-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 8px 0; font-size: 12px; }
.batch-group-summary { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 12px; font-size: 12px; color: #606266; }
.identifier-warning { margin-bottom: 12px; }
.manage-hint { margin: 0 0 8px; color: #606266; font-size: 13px; }
.manage-summary { margin-bottom: 12px; font-size: 13px; font-weight: 500; }
.managed-record-list { display: flex; flex-direction: column; gap: 8px; max-height: 350px; overflow-y: auto; }
.managed-record-item { display: flex; width: 100%; margin: 0 !important; }
.manage-actions { display: flex; align-items: center; gap: 8px; }
.manage-action-spacer { flex: 1; }
.qr-warning-list { max-height: 160px; overflow-y: auto; margin: 8px 0; padding-left: 20px; }

.print-sheet { width: 100%; box-sizing: border-box; margin-bottom: 12px; }
.my-grid-table {
  display: flex; flex-direction: column; width: 100%; box-sizing: border-box;
  font-family: Arial, "Microsoft YaHei", sans-serif;
  font-size: var(--card-font-size, 9pt); line-height: 1.25; letter-spacing: 0;
  border: 1px solid #000; border-radius: 0; background: #fff;
}
.my-grid-row {
  display: grid; grid-template-columns: var(--card-label-width, 32%) minmax(0, 1fr);
  width: 100%; box-sizing: border-box; border-bottom: 1px solid #000; break-inside: avoid;
}
.my-grid-row:last-child { border-bottom: none; }
.my-grid-cell {
  min-width: 0; box-sizing: border-box; padding: var(--card-cell-padding, 1.5mm) 1.5mm;
  background: #fff; overflow-wrap: anywhere; word-break: break-word;
}
.label-cell { border-right: 1px solid #000; font-weight: 500; }
.value-cell { font-weight: 400; }
.qr-image {
  display: block; width: var(--card-qr-size, 20mm); height: var(--card-qr-size, 20mm);
  max-width: 100%; object-fit: contain;
}
.layout-description { font-size: 12px; color: #909399; line-height: 1.6; }
.layout-description p { margin: 4px 0; }

@media print {
  .my-tools-container, .workspace-switcher, .history-panel { display: none !important; }
  .print-sheet {
    width: 92mm; max-width: 92mm; margin: 0 auto;
    break-inside: avoid; page-break-inside: avoid;
    break-after: page; page-break-after: always;
  }
  .print-sheet:last-child { break-after: auto; page-break-after: auto; }
  .my-grid-table {
    width: 92mm; max-width: 92mm; font-size: var(--card-font-size, 9pt);
    border: 1px solid #000; margin: 0;
  }
  .my-grid-row {
    grid-template-columns: var(--card-label-width, 32%) minmax(0, 1fr); break-inside: avoid;
  }
  .my-grid-cell { padding: var(--card-cell-padding, 1.5mm) 1.5mm; }
  .qr-image {
    width: var(--card-qr-size, 20mm); height: var(--card-qr-size, 20mm);
    max-width: 100%; object-fit: contain;
  }
}
</style>

<style>
@page { size: 100mm 150mm; margin: 4mm; }
@media print {
  html, body, #app { margin: 0 !important; padding: 0 !important; }
  .my-tools-container, .workspace-switcher, .history-panel, .el-overlay { display: none !important; }
  /* Hide the injected Netlify badge in PDF output. */
  body > :not(#app) { display: none !important; }
}
</style>
