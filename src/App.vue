
<script setup lang="ts">
import { bitable, FieldType } from '@lark-base-open/js-sdk';
import { computed, onBeforeMount, ref, watch } from 'vue';
import usePrint from './hooks/usePrint';

const {
  selectRecord,
  handlePrint,
  init,
  handleSetting,
  handleSettingListUpdate,
  currentRecord,
  isSettingPanelShow,
  settingList
} = usePrint();

// --------------------------------------
// Print layout settings
// --------------------------------------

const LAYOUT_KEY = 'erp_process_card_layout_v1';

const layout = ref({
  fontSize: 9,
  cellPadding: 1.5,
  labelWidth: 32
});

// Always render one field per row.
// Existing field selection and ordering
// remain managed by usePrint.ts.
const printFields = computed(() => {
  return currentRecord.value?.flat() ?? [];
});

// --------------------------------------
// Load saved layout
// --------------------------------------

onBeforeMount(async () => {
  await init();

  try {
    const saved = await bitable.bridge.getData<{
      fontSize?: number;
      cellPadding?: number;
      labelWidth?: number;
    }>(LAYOUT_KEY);

    if (saved) {
      layout.value = {
        fontSize: saved.fontSize ?? 9,
        cellPadding: saved.cellPadding ?? 1.5,
        labelWidth: saved.labelWidth ?? 32
      };
    }
  } catch (error) {
    console.error('Failed to load layout settings:', error);
  }
});

// --------------------------------------
// Save settings when they change
// --------------------------------------

watch(
  layout,
  async value => {
    try {
      await bitable.bridge.setData(
        LAYOUT_KEY,
        { ...value }
      );
    } catch (error) {
      console.error('Failed to save layout settings:', error);
    }
  },
  { deep: true }
);
</script>

<template>
  <!-- Main controls -->
  <div class="my-tools-container">
    <el-button @click="selectRecord">
      选择记录
    </el-button>

    <el-button @click="handlePrint">
      打印
    </el-button>

    <el-button @click="handleSetting">
      设置
    </el-button>
  </div>

  <!-- Settings window -->
  <el-dialog
    v-model="isSettingPanelShow"
    title="工艺卡打印设置"
    width="600px"
    top="5vh"
    class="print-settings-dialog"
    append-to-body
  >
    <el-tabs model-value="fields">

      <!-- Field selection -->
      <el-tab-pane
        label="字段设置"
        name="fields"
      >
        <settings-panel
          :list="settingList"
          @update:list="handleSettingListUpdate"
        />
      </el-tab-pane>

      <!-- Layout controls -->
      <el-tab-pane
        label="排版设置"
        name="layout"
      >
        <el-form label-position="top">

          <el-form-item label="字体大小 (pt)">
            <el-slider
              v-model="layout.fontSize"
              :min="7"
              :max="13"
              :step="0.5"
              show-input
            />
          </el-form-item>

          <el-form-item label="上下间距 (mm)">
            <el-slider
              v-model="layout.cellPadding"
              :min="0.5"
              :max="4"
              :step="0.5"
              show-input
            />
          </el-form-item>

          <el-form-item label="字段名称列宽 (%)">
            <el-slider
              v-model="layout.labelWidth"
              :min="15"
              :max="65"
              :step="1"
              show-input
            />
          </el-form-item>

          <el-divider />

          <div class="layout-description">
            <p>
              纸张尺寸：100 × 150 mm
            </p>
            <p>
              调整滑块时，工艺卡实时更新。
            </p>
            <p>
              设置会自动保存。
            </p>
          </div>

        </el-form>
      </el-tab-pane>

    </el-tabs>
  </el-dialog>

  <!-- Process card -->
  <div
    v-if="currentRecord"
    id="my-print-container"
    class="my-grid-table"
    :style="{
      '--card-font-size': layout.fontSize + 'pt',
      '--card-cell-padding': layout.cellPadding + 'mm',
      '--card-label-width': layout.labelWidth + '%'
    }"
  >
    <div
      v-for="field in printFields"
      :key="field.id"
      class="my-grid-row"
    >
      <!-- Field label -->
      <div class="my-grid-cell label-cell">
        {{ field.name }}
      </div>

      <!-- Field value -->
      <div class="my-grid-cell value-cell">

        <!-- Image attachment -->
        <template
          v-if="field.type === FieldType.Attachment"
        >
          <img
            v-for="(url, index) in field.value"
            :key="index"
            :src="url"
            class="qr-image"
            alt="附件图片"
          />
        </template>

        <!-- Text or other fields -->
        <template v-else>
          {{ field.value }}
        </template>

      </div>
    </div>
  </div>
</template>

<style scoped>
/* --------------------------------------
   Live card preview
-------------------------------------- */

.my-grid-table {
  display: flex;
  flex-direction: column;

  width: 100%;
  box-sizing: border-box;

  font-family:
    Arial,
    "Microsoft YaHei",
    sans-serif;

  font-size: var(--card-font-size, 9pt);
  line-height: 1.25;
  letter-spacing: 0;

  border: 1px solid #000;
  border-radius: 0;
  background: #fff;
}

/* --------------------------------------
   Two-column row
-------------------------------------- */

.my-grid-row {
  display: grid;

  grid-template-columns:
    var(--card-label-width, 32%)
    minmax(0, 1fr);

  width: 100%;
  box-sizing: border-box;

  border-bottom: 1px solid #000;

  break-inside: avoid;
}

.my-grid-row:last-child {
  border-bottom: none;
}

/* --------------------------------------
   Cells
-------------------------------------- */

.my-grid-cell {
  min-width: 0;
  box-sizing: border-box;

  padding:
    var(--card-cell-padding, 1.5mm)
    1.5mm;

  background: #fff;

  overflow-wrap: anywhere;
  word-break: break-word;
}

.label-cell {
  border-right: 1px solid #000;
  font-weight: 500;
}

.value-cell {
  font-weight: 400;
}

/* --------------------------------------
   Image / QR code
-------------------------------------- */

.qr-image {
  display: block;

  width: 25mm;
  height: 25mm;
  max-width: 100%;

  object-fit: contain;
}

/* --------------------------------------
   Layout settings information
-------------------------------------- */

.layout-description {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}

.layout-description p {
  margin: 4px 0;
}

/* --------------------------------------
   Print styles
-------------------------------------- */

@media print {
  .my-tools-container {
    display: none !important;
  }

  .my-grid-table {
    width: 92mm;
    max-width: 92mm;

    box-sizing: border-box;

    font-size: var(--card-font-size, 9pt);

    border: 1px solid #000;
    border-radius: 0;

    margin: 0;
  }

  .my-grid-row {
    grid-template-columns:
      var(--card-label-width, 32%)
      minmax(0, 1fr);

    break-inside: avoid;
  }

  .my-grid-cell {
    padding:
      var(--card-cell-padding, 1.5mm)
      1.5mm;
  }

  .qr-image {
    width: 25mm;
    height: 25mm;

    max-width: 100%;
    object-fit: contain;
  }
}
</style>

<style>
/* Print paper settings are global, not scoped */

@page {
  size: 100mm 150mm;
  margin: 4mm;
}

@media print {
  html,
  body,
  #app {
    margin: 0 !important;
    padding: 0 !important;
  }

  .my-tools-container,
  .el-overlay {
    display: none !important;
  }
}
</style>
