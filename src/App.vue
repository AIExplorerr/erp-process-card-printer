<script setup lang="ts">
import { bitable, FieldType, ToastType } from '@lark-base-open/js-sdk';
import { computed, nextTick, onBeforeMount, onBeforeUnmount, ref, watch } from 'vue';
import usePrint from './hooks/usePrint';

const {
  selectRecord,
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

const isManagePanelShow = ref(false);
const managedRecordIds = ref<string[]>([]);
const selectAllManaged = () => { managedRecordIds.value = selectedRecordIds.value.slice(); };
const deselectAllManaged = () => { managedRecordIds.value = []; };
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
const applyManagedSelection = () => {
  retainSelectedRecords(managedRecordIds.value);
  isManagePanelShow.value = false;
};
const confirmClearSelection = () => {
  clearSelection();
  managedRecordIds.value = [];
  isManagePanelShow.value = false;
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
  if (isLoading.value || printInProgress.value || !printItems.value.length) return;
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

  // In Feishu's embedded browser, afterprint normally fires when preview closes.
  try { window.print(); }
  catch (error) {
    resetPrintMode();
    bitable.ui.showToast({ toastType: ToastType.error, message: '无法打开打印预览，请重试' });
  }
};

onBeforeMount(async () => {
  window.addEventListener('afterprint', resetPrintMode);
  await init();
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
onBeforeUnmount(() => window.removeEventListener('afterprint', resetPrintMode));

const LAYOUT_KEY = 'erp_process_card_layout_v1';
const layout = ref({ fontSize: 9, cellPadding: 1.5, labelWidth: 32, qrSize: 20 });
watch(layout, async value => {
  try { await bitable.bridge.setData(LAYOUT_KEY, { ...value }); }
  catch (error) { console.error('Failed to save layout settings:', error); }
}, { deep: true });
</script>

<template>
  <div class="my-tools-container">
    <el-button :loading="isLoading" :disabled="printInProgress" @click="selectRecord">添加记录</el-button>
    <el-button :disabled="isLoading || printInProgress || currentRecords.length === 0" @click="openManagePanel">
      管理已选 ({{ currentRecords.length }})
    </el-button>
    <el-button :disabled="isLoading || printInProgress || currentRecords.length === 0" @click="openPrintConfirmation">打印</el-button>
    <el-button :disabled="isLoading || printInProgress" @click="handleSetting">设置</el-button>
    <span v-if="currentRecords.length" class="card-count">已选 {{ currentRecords.length }} 张 · {{ batchGroups.length }} 组 · 预计 {{ currentRecords.length }} 页</span>
    <span v-if="isLoading" class="card-count">读取中 {{ loadProgress.done }}/{{ loadProgress.total }}</span>
    <span v-else-if="restoreNotice" class="card-count">{{ restoreNotice }}</span>
  </div>

  <el-dialog
    v-model="isPrintConfirmShow"
    title="打印前确认"
    width="520px"
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
    width="600px"
    top="5vh"
    append-to-body
    class="manage-records-dialog"
  >
    <p class="manage-hint">已按周转单位编号自动排序（工单编号 → #后数字）。此列表顺序即最终打印顺序。</p>
    <p class="manage-hint">取消勾选不需要打印的记录，然后点击「应用选择」。</p>
    <div class="manage-summary">当前批次 {{ selectedRecordIds.length }} 条，保留 {{ managedRecordIds.length }} 条</div>
    <div class="manage-toolbar">
      <el-button size="small" @click="selectAllManaged">全选</el-button>
      <el-button size="small" @click="deselectAllManaged">全不选</el-button>
      <span>共 {{ batchGroups.length }} 个编号组</span>
    </div>
    <div class="batch-group-summary">
      <span v-for="group in batchGroups" :key="group.name">{{ group.name }}：{{ group.count }} 张</span>
    </div>
    <el-checkbox-group v-model="managedRecordIds" class="managed-record-list">
      <el-checkbox
        v-for="(record, index) in selectedRecordLabels"
        :key="record.id"
        :value="record.id"
        class="managed-record-item"
      >{{ index + 1 }}. {{ record.label }}</el-checkbox>
    </el-checkbox-group>
    <template #footer>
      <div class="manage-actions">
        <el-popconfirm
          title="确认清空当前批次的全部记录？"
          confirm-button-text="确认清空"
          cancel-button-text="取消"
          @confirm="confirmClearSelection"
        >
          <template #reference><el-button type="danger" plain>清空选择</el-button></template>
        </el-popconfirm>
        <span class="manage-action-spacer"></span>
        <el-button @click="isManagePanelShow = false">取消</el-button>
        <el-button type="primary" @click="applyManagedSelection">应用选择</el-button>
      </div>
    </template>
  </el-dialog>

  <el-dialog
    v-model="isSettingPanelShow"
    title="工艺卡打印设置"
    width="600px"
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

  <div v-if="currentRecords.length" id="my-print-container">
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
  .my-tools-container { display: none !important; }
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
  .my-tools-container, .el-overlay { display: none !important; }
  /* Hide the injected Netlify badge in PDF output. */
  body > :not(#app) { display: none !important; }
}
</style>
