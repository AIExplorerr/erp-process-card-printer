<script setup lang="ts">
import { FieldType } from '@lark-base-open/js-sdk';
import { onBeforeMount } from 'vue';
import usePrint from './hooks/usePrint';
const { selectRecord, handlePrint, init, handleSetting, handleSettingListUpdate, currentRecord, isSettingPanelShow, settingList } = usePrint();

onBeforeMount(() => {
  init();
});

</script>

<template>
  <div class="my-tools-container">
    <el-button @click="selectRecord">选择记录</el-button>
    <el-button @click="handlePrint">打印</el-button>
    <el-button @click="handleSetting">设置</el-button>

    <el-dialog
      v-model="isSettingPanelShow"
      title="工艺卡字段设置"
      width="600px"
      top="5vh"
      class="print-settings-dialog"
    >
      <settings-panel
        :list="settingList"
        @update:list="handleSettingListUpdate"
      />
    </el-dialog>
  </div>

  <div v-if="currentRecord" id="my-print-container" class="my-grid-table">
    <template v-for="(fieldItem, index) in currentRecord" :key="index">
      <div
        v-if="fieldItem.length === 1"
        class="my-grid-row"
      >
        <div class="my-grid-cell">{{ fieldItem[0].name }}</div>
        <template v-if="fieldItem[0].type === FieldType.Attachment">
          <img v-for="v in fieldItem[0].value" class="my-grid-cell value-span" :src="v" />
        </template>
        <div v-else class="my-grid-cell value-span">{{ fieldItem[0].value }}</div>
      </div>
      <div
        v-else
        class="my-grid-row"
      >
        <div class="my-grid-cell">{{ fieldItem[0].name }}</div>
          <div class="my-grid-cell">
            <template v-if="fieldItem[0].type === FieldType.Attachment">
              <img
                v-for="(url, i) in fieldItem[0].value"
                :key="i"
                :src="url"
                class="qr-image"
              />
            </template>
            <template v-else>
              {{ fieldItem[0].value }}
            </template>
          </div>
          
          <div class="my-grid-cell">{{ fieldItem[1].name }}</div>
          
          <div class="my-grid-cell">
            <template v-if="fieldItem[1].type === FieldType.Attachment">
              <img
                v-for="(url, i) in fieldItem[1].value"
                :key="i"
                :src="url"
                class="qr-image"
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
  font-family: sans-serif;
  font-size: 0.8rem;
  letter-spacing: 1px;
  border: 2px solid #000;
  border-radius: 4px;
  overflow: hidden;
}
.my-grid-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  border-bottom: 1px solid #000;
}
.my-grid-cell {
  border-right: 1px solid #000;
  border-bottom: 1px solid #000;
  padding: 8px;
  background: #fff;
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
  height: 120px;
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
    font-size: 9pt;
    letter-spacing: 0;
    border: 1px solid #000;
    border-radius: 0;
    overflow: visible;
  }

  .my-grid-row {
    grid-template-columns: 28% 72%;
    break-inside: avoid;
  }

  .my-grid-cell {
    padding: 1.5mm;
    border-right: 1px solid #000;
    border-bottom: 1px solid #000;
    overflow-wrap: anywhere;
  }

  .value-span {
    grid-column: auto;
  }

  .qr-image {
    width: 25mm;
    height: 25mm;
    object-fit: contain;
  }

  #my-print-container {
    break-inside: avoid;
  }
}
</style>
