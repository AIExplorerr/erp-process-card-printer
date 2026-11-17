import { bitable, FieldType, ToastType } from '@lark-base-open/js-sdk';
import type { IFieldMeta } from '@lark-base-open/js-sdk';
import { ref } from 'vue';
import type { IFieldMetaSettings, IFieldMetaWithValue } from '../types';

const SETTING_KEY = 'my_print_setting';

type SelectedRecordLabel = { id: string; label: string };

// Sort production orders naturally and the sequence after # numerically.
// Examples: GD-00144#2 before GD-00144#10, and GD-00144 before GD-00145.
const naturalOrder = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

const compareCardLabels = (left: string, right: string): number => {
  const a = /^(.*)#(\d+)$/.exec(left.trim());
  const b = /^(.*)#(\d+)$/.exec(right.trim());

  // Unrecognizable identifiers stay at the end, in their original selection order.
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const orderComparison = naturalOrder.compare(a[1], b[1]);
  if (orderComparison !== 0) return orderComparison;

  const sequenceA = BigInt(a[2]);
  const sequenceB = BigInt(b[2]);
  return sequenceA < sequenceB ? -1 : sequenceA > sequenceB ? 1 : 0;
};

const usePrint = () => {
  const selectedRecordIds = ref<string[]>([]);
  const selectedRecordLabels = ref<SelectedRecordLabel[]>([]);
  const currentRecords = ref<IFieldMetaWithValue[][]>([]);
  const fieldList = ref<IFieldMeta[]>([]);
  const isSettingPanelShow = ref(false);
  const settingList = ref<IFieldMetaSettings[]>([]);
  const isLoading = ref(false);

  const init = async () => {
    const table = await bitable.base.getActiveTable();
    fieldList.value = await table.getFieldMetaList();
    await getSettingList();
  };

  const getSettingList = async () => {
    const data = await bitable.bridge.getData<IFieldMetaSettings[]>(SETTING_KEY);
    const fieldMap = new Map(fieldList.value.map(field => [field.id, field]));

    // Keep user-selected field order and visibility exactly as before.
    const savedSettings = Array.isArray(data)
      ? data
          .filter(setting => fieldMap.has(setting.fieldId))
          .map(setting => ({ ...setting, name: fieldMap.get(setting.fieldId)!.name }))
      : [];

    const savedIds = new Set(savedSettings.map(setting => setting.fieldId));
    const newFields = fieldList.value
      .filter(field => !savedIds.has(field.id))
      .map(field => ({
        fieldId: field.id,
        name: field.name,
        oneLine: field.type === FieldType.Attachment,
        hidden: true
      }));

    settingList.value = [...savedSettings, ...newFields];
  };

  const loadSelectedRecords = async () => {
    if (selectedRecordIds.value.length === 0) {
      currentRecords.value = [];
      selectedRecordLabels.value = [];
      return;
    }

    isLoading.value = true;
    try {
      const table = await bitable.base.getActiveTable();
      const orderedSettings = settingList.value.filter(setting => !setting.hidden);
      const fieldMetaMap = new Map(fieldList.value.map(field => [field.id, field]));
      const identifierField = fieldList.value.find(field => field.name === '周转单位编号')
        ?? fieldList.value.find(field => field.name === '工艺卡编号');

      const loadedCards: IFieldMetaWithValue[][] = [];
      const labels: SelectedRecordLabel[] = [];

      // Load sequentially to avoid overwhelming Feishu with requests.
      for (const [index, recordId] of selectedRecordIds.value.entries()) {
        const values = await Promise.all(
          orderedSettings.map(async setting => {
            const field = fieldMetaMap.get(setting.fieldId);
            if (!field) return null;

            if (field.type === FieldType.Attachment) {
              const attachmentValue = await table.getCellValue(field.id, recordId);
              const tokens = Array.isArray(attachmentValue)
                ? (attachmentValue as Array<{ token?: string }>)
                    .map(item => item.token)
                    .filter((token): token is string => Boolean(token))
                : [];
              const urls = tokens.length
                ? await table.getCellAttachmentUrls(tokens, field.id, recordId)
                : [];
              return { ...field, value: urls } as IFieldMetaWithValue;
            }

            const value = await table.getCellString(field.id, recordId);
            return { ...field, value } as IFieldMetaWithValue;
          })
        );

        const card = values.filter((item): item is IFieldMetaWithValue => item !== null);
        loadedCards.push(card);

        let label = '';
        if (identifierField) {
          const alreadyRead = card.find(field => field.id === identifierField.id);
          label = typeof alreadyRead?.value === 'string'
            ? alreadyRead.value
            : await table.getCellString(identifierField.id, recordId);
        }
        labels.push({ id: recordId, label: label.trim() || `记录 ${index + 1}` });
      }

      // Sort once, then update IDs, labels and cards in precisely the same order.
      // This also determines print/PDF order and management-dialog order.
      const sorted = labels
        .map((item, index) => ({ item, index, card: loadedCards[index] }))
        .sort((a, b) => compareCardLabels(a.item.label, b.item.label) || a.index - b.index);

      selectedRecordIds.value = sorted.map(entry => entry.item.id);
      selectedRecordLabels.value = sorted.map(entry => entry.item);
      currentRecords.value = sorted.map(entry => entry.card);
    } catch (error) {
      console.error('Failed to load process cards:', error);
      bitable.ui.showToast({ toastType: ToastType.error, message: '读取工艺卡失败，请重试' });
    } finally {
      isLoading.value = false;
    }
  };

  // The native Feishu picker cannot be prechecked; treat its result as ADDITIONS.
  const selectRecord = async () => {
    if (isLoading.value) return;
    try {
      const table = await bitable.base.getActiveTable();
      const view = await table.getActiveView();
      const newlyChosen = await bitable.ui.selectRecordIdList(table.id, view.id);
      if (!Array.isArray(newlyChosen) || newlyChosen.length === 0) return;

      const merged = [...new Set([...selectedRecordIds.value, ...newlyChosen])];
      if (merged.length === selectedRecordIds.value.length) {
        bitable.ui.showToast({ toastType: ToastType.success, message: '所选记录已在当前批次中' });
        return;
      }
      selectedRecordIds.value = merged;
      await loadSelectedRecords();
    } catch (error) {
      console.error('Failed to add records:', error);
      bitable.ui.showToast({ toastType: ToastType.error, message: '添加记录失败' });
    }
  };

  // Filter loaded cards and labels in place; no new API requests are needed.
  const retainSelectedRecords = (idsToKeep: string[]) => {
    if (isLoading.value) return;
    const keep = new Set(idsToKeep);
    const indices = selectedRecordIds.value
      .map((id, index) => ({ id, index }))
      .filter(item => keep.has(item.id));

    selectedRecordIds.value = indices.map(item => item.id);
    currentRecords.value = indices.map(item => currentRecords.value[item.index]);
    selectedRecordLabels.value = indices.map(item => selectedRecordLabels.value[item.index]);
  };

  const clearSelection = () => {
    if (isLoading.value) return;
    selectedRecordIds.value = [];
    currentRecords.value = [];
    selectedRecordLabels.value = [];
  };

  const handleSettingListUpdate = async (list: IFieldMetaSettings[], showToast = true) => {
    settingList.value = list;
    try {
      const saved = await bitable.bridge.setData(SETTING_KEY, list);
      if (showToast) {
        bitable.ui.showToast({
          toastType: saved ? ToastType.success : ToastType.error,
          message: saved ? '更新打印配置成功' : '更新打印配置失败'
        });
      }
      await loadSelectedRecords();
    } catch (error) {
      console.error('Failed to save print settings:', error);
      bitable.ui.showToast({ toastType: ToastType.error, message: '保存打印配置失败' });
    }
  };

  const handleSetting = () => {
    isSettingPanelShow.value = true;
  };

  const handlePrint = () => {
    if (!isLoading.value && currentRecords.value.length > 0) window.print();
  };

  return {
    selectedRecordIds,
    selectedRecordLabels,
    currentRecords,
    isLoading,
    isSettingPanelShow,
    settingList,
    init,
    selectRecord,
    retainSelectedRecords,
    clearSelection,
    handlePrint,
    handleSetting,
    handleSettingListUpdate
  };
};

export default usePrint;
