
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

const LAYOUT_KEY = 'erp_process_card_layout_v1';

const layout = ref({
  fontSize: 9,
  cellPadding: 1.5,
  labelWidth: 30,
  groupWidth: 50
});

// Calculate the four columns as valid CSS percentages.
const columnWidths = computed(() => {
  const group = layout.value.groupWidth / 100;
  const label = layout.value.labelWidth / 100;

  return [
    group * label,
    group * (1 - label),
    (1 - group) * label,
    (1 - group) * (1 - label)
  ]
    .map(value => `${value * 100}%`)
    .join(' ');
});

onBeforeMount(async () => {
  await init();

  try {
    const saved = await bitable.bridge.getData<{
      fontSize?: number;
      cellPadding?: number;
      labelWidth?: number;
      groupWidth?: number;
    }>(LAYOUT_KEY);

    if (saved) {
      layout.value = {
        fontSize: saved.fontSize ?? 9,
        cellPadding: saved.cellPadding ?? 1.5,
        labelWidth: saved.labelWidth ?? 30,
        groupWidth: saved.groupWidth ?? 50
      };
    }
  } catch (error) {
    console.error('Failed to load layout settings:', error);
  }
});

watch(
  layout,
  async value => {
    try {
      await bitable.bridge.setData(LAYOUT_KEY, { ...value });
    } catch (error) {
      console.error('Failed to save layout settings:', error);
    }
  },
  { deep: true }
);
</script>

<template>
  <div class="my-tools-container">
    <el-button @click="selectRecord">选择记录</el-button>
    <el-button @click="handlePrint">打印</el-button>
    <el-button @click="handleSetting">设置</el-button>
  </div>

  <el-dialog
    v-model="isSettingPanelShow"
    title="工艺卡打印设置"
    width="600px"
    top="5vh"
    class="print-settings-dialog"
  >
    <el-tabs model-value="fields">
      <el-tab-pane label="字段设置" name="fields">
        <settings-panel
          :list="settingList"
          @update:list="handleSettingListUpdate"
        />
      </el-tab-pane>

      <el-tab-pane label="排版设置" name="layout">
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
              :max="45"
              :step="1"
              show-input
            />
          </el-form-item>

          <el-form-item label="左右字段组比例 (%)">
            <el-slider
              v-model="layout.groupWidth"
              :min="35"
              :max="65"
              :step="1"
              show-input
            />
          </el-form-item>

        </el-form>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>

  <div
    v-if="currentRecord"
    id="my-print-container"
    class="my-grid-table"
    :style="{
      '--card-font-size': layout.fontSize + 'pt',
      '--card-cell-padding': layout.cellPadding + 'mm',
      '--card-columns': columnWidths
    }"
  >
    <template
      v-for="(fieldItem, index) in currentRecord"
      :key="index"
    >
      <!-- Full-width field -->
      <div
        v-if="fieldItem.length === 1"
        class="my-grid-row"
      >
        <div class="my-grid-cell">
          {{ fieldItem[0].name }}
        </div>

        <div class="my-grid-cell value-span">
          <template
            v-if="fieldItem[0].type === FieldType.Attachment"
          >
            <img
              v-for="(url, i) in fieldItem[0].value"
              :key="i"
              :src="url"
              class="qr-image"
              alt="附件图片"
            />
          </template>

          <template v-else>
            {{ fieldItem[0].value }}
          </template>
        </div>
      </div>

      <!-- Two fields in one row -->
      <div
        v-else
        class="my-grid-row"
      >
        <div class="my-grid-cell">
          {{ fieldItem[0].name }}
        </div>

        <div class="my-grid-cell">
          <template
            v-if="fieldItem[0].type === FieldType.Attachment"
          >
            <img
              v-for="(url, i) in fieldItem[0].value"
              :key="i"
              :src="url"
              class="qr-image"
              alt="附件图片"
            />
          </template>

          <template v-else>
            {{ fieldItem[0].value }}
          </template>
        </div>

        <div class="my-grid-cell">
          {{ fieldItem[1].name }}
        </div>

        <div class="my-grid-cell">
          <template
            v-if="fieldItem[1].type === FieldType.Attachment"
          >
            <img
              v-for="(url, i) in fieldItem[1].value"
              :key="i"
              :src="url"
              class="qr-image"
              alt="附件图片"
            />
          </template>

          <template v-else>
            {{ fieldItem[1].value }}
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.my-grid-table {
  display: flex;
  flex-direction: column;
  width: 90%;
  box-sizing: border-box;
  font-family: sans-serif;
  font-size: var(--card-font-size, 9pt);
  letter-spacing: 0;
  border: 2px solid #000;
  border-radius: 4px;
  overflow: hidden;
}

.my-grid-row {
  display: grid;
  grid-template-columns:
    var(--card-columns, 15% 35% 15% 35%);
  border-bottom: 1px solid #000;
}

.my-grid-cell {
  box-sizing: border-box;
  min-width: 0;
  border-right: 1px solid #000;
  border-bottom: 1px solid #000;
  padding: var(--card-cell-padding, 1.5mm) 1.5mm;
  background: #fff;
  overflow-wrap: anywhere;
}

.value-span {
  grid-column: 2 / span 3;
}

.my-grid-row:last-child .my-grid-cell {
  border-bottom: none;
}

.my-grid-cell:last-child {
  border-right: none;
}

.qr-image {
  width: 120px;
  max-width: 100%;
  height: auto;
  object-fit: contain;
  display: block;
}

@page {
  size: 100mm 150mm;
  margin: 4mm;
}

@media print {
  .my-grid-table {
    width: 92mm;
    max-width: 92mm;
    box-sizing: border-box;
    font-size: var(--card-font-size, 9pt);
    letter-spacing: 0;
    border: 1px solid #000;
    border-radius: 0;
    overflow: visible;
  }

  .my-grid-row {
    grid-template-columns:
      var(--card-columns, 15% 35% 15% 35%);
    break-inside: avoid;
  }

  .my-grid-cell {
    padding: var(--card-cell-padding, 1.5mm) 1.5mm;
    border-right: 1px solid #000;
    border-bottom: 1px solid #000;
    overflow-wrap: anywhere;
  }

  .value-span {
    grid-column: 2 / span 3;
  }

  .qr-image {
    width: 25mm;
    max-width: 100%;
    height: 25mm;
    object-fit: contain;
  }

  #my-print-container {
    break-inside: avoid;
  }
}
</style>
