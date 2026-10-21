
<template>
  <div class="layout-editor">
    <div class="section-title">
      <strong>已选字段</strong>
      <span>{{ selectedFields.length }} 个字段</span>
    </div>
    <p class="hint">拖动 ⠿ 调整顺序，点击 × 移除字段。</p>

    <div ref="selectedContainer" class="selected-list">
      <div
        v-for="item in selectedFields"
        :key="item.fieldId"
        class="selected-item"
        :data-field-id="item.fieldId"
      >
        <span class="drag-handle" title="拖动排序">⠿</span>

        <div class="field-content">
          <div class="field-name">{{ item.name }}</div>
          <label class="option">
            <el-switch
              size="small"
              :model-value="item.oneLine"
              @change="toggleOneLine(item)"
            />
            单行显示
          </label>
        </div>

        <el-button
          size="small"
          text
          type="danger"
          title="从工艺卡移除"
          @click="removeField(item)"
        >
          ×
        </el-button>
      </div>
    </div>

    <el-empty
      v-if="selectedFields.length === 0"
      description="暂未选择打印字段"
      :image-size="55"
    />

    <el-divider />

    <div class="section-title">
      <strong>可添加字段</strong>
      <span>{{ availableFields.length }} 个字段</span>
    </div>

    <el-input
      v-model="keyword"
      clearable
      placeholder="搜索字段名称"
      class="search-box"
    />

    <div class="available-list">
      <div
        v-for="item in filteredAvailableFields"
        :key="item.fieldId"
        class="available-item"
      >
        <span class="field-name">{{ item.name }}</span>
        <el-button
          size="small"
          type="primary"
          plain
          @click="addField(item)"
        >
          + 添加
        </el-button>
      </div>
    </div>

    <el-empty
      v-if="filteredAvailableFields.length === 0"
      description="没有可添加的字段"
      :image-size="55"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDraggable } from 'vue-draggable-plus';
import type { IFieldMetaSettings } from '../types';

const props = defineProps<{
  list: IFieldMetaSettings[];
}>();

const emit = defineEmits<{
  (e: 'update:list', value: IFieldMetaSettings[]): void;
}>();

const keyword = ref('');
const selectedContainer = ref<HTMLElement | null>(null);

const selectedFields = computed(() =>
  props.list.filter(item => !item.hidden)
);

const availableFields = computed(() =>
  props.list.filter(item => item.hidden)
);

const filteredAvailableFields = computed(() =>
  availableFields.value.filter(item =>
    item.name.toLowerCase().includes(keyword.value.trim().toLowerCase())
  )
);

const save = (updated: IFieldMetaSettings[]) => {
  emit('update:list', updated);
};

const removeField = (item: IFieldMetaSettings) => {
  save(
    props.list.map(field =>
      field.fieldId === item.fieldId
        ? { ...field, hidden: true }
        : { ...field }
    )
  );
};

const addField = (item: IFieldMetaSettings) => {
  const selected = props.list
    .filter(field => !field.hidden)
    .map(field => ({ ...field }));

  const available = props.list
    .filter(field => field.hidden && field.fieldId !== item.fieldId)
    .map(field => ({ ...field }));

  save([
    ...selected,
    { ...item, hidden: false },
    ...available
  ]);
};

const toggleOneLine = (item: IFieldMetaSettings) => {
  save(
    props.list.map(field =>
      field.fieldId === item.fieldId
        ? { ...field, oneLine: !field.oneLine }
        : { ...field }
    )
  );
};

useDraggable(selectedContainer, {
  animation: 150,
  handle: '.drag-handle',
  draggable: '.selected-item',
  onEnd: event => {
    const from = event.oldIndex;
    const to = event.newIndex;

    if (
      from == null ||
      to == null ||
      from === to
    ) return;

    const selected = props.list
      .filter(item => !item.hidden)
      .map(item => ({ ...item }));

    const available = props.list
      .filter(item => item.hidden)
      .map(item => ({ ...item }));

    const moved = selected.splice(from, 1)[0];
    selected.splice(to, 0, moved);

    save([...selected, ...available]);
  }
});
</script>

<style scoped>
.layout-editor {
  width: 100%;
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.section-title span,
.hint {
  color: #909399;
  font-size: 12px;
}

.hint {
  margin: 0 0 12px;
}

.selected-list,
.available-list {
  max-height: 320px;
  overflow-y: auto;
}

.selected-item,
.available-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 6px;
  border-bottom: 1px solid #ebeef5;
}

.drag-handle {
  cursor: grab;
  font-size: 22px;
  color: #909399;
  user-select: none;
}

.field-content {
  flex: 1;
  min-width: 0;
}

.field-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.option {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  font-size: 12px;
  color: #606266;
}

.search-box {
  margin: 8px 0;
}

.available-item {
  justify-content: space-between;
}
</style>
