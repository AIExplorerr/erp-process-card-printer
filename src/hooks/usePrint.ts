import { bitable, FieldType, ToastType } from '@lark-base-open/js-sdk';
import type { IFieldMeta } from '@lark-base-open/js-sdk';
import { ref } from 'vue';
import type { IFieldMetaSettings, IFieldMetaWithValue } from '../types';

const SETTING_KEY = 'my_print_setting';

const usePrint = () => {
  const selectedRecordIds = ref<string[]>([]);
  const fieldList = ref<IFieldMeta[]>([]);
  const currentRecords = ref<IFieldMetaWithValue[][]>([]);
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

    // Preserve saved field order and visibility.
    const savedSettings = Array.isArray(data)
      ? data
          .filter(setting => fieldMap.has(setting.fieldId))
          .map(setting => ({
            ...setting,
            name: fieldMap.get(setting.fieldId)!.name
          }))
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
      return;
    }

    isLoading.value = true;
    try {
      const table = await bitable.base.getActiveTable();
      const orderedSettings = settingList.value.filter(setting => !setting.hidden);
      const fieldMetaMap = new Map(fieldList.value.map(field => [field.id, field]));
      const loadedCards: IFieldMetaWithValue[][] = [];

      // Read one record at a time to avoid overwhelming Feishu with requests.
      // Within each record, fetch visible fields concurrently.
      for (const recordId of selectedRecordIds.value) {
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
        loadedCards.push(values.filter((item): item is IFieldMetaWithValue => item !== null));
      }

      currentRecords.value = loadedCards;
    } catch (error) {
      console.error('Failed to load process cards:', error);
      bitable.ui.showToast({
        toastType: ToastType.error,
        message: '读取工艺卡失败，请重试'
      });
    } finally {
      isLoading.value = false;
    }
  };

  const selectRecord = async () => {
    try {
      const table = await bitable.base.getActiveTable();
      const view = await table.getActiveView();
      const recordIds = await bitable.ui.selectRecordIdList(table.id, view.id);

      if (!Array.isArray(recordIds) || recordIds.length === 0) return;

      selectedRecordIds.value = [...new Set(recordIds)];
      await loadSelectedRecords();
    } catch (error) {
      console.error('Failed to select records:', error);
      bitable.ui.showToast({ toastType: ToastType.error, message: '选择记录失败' });
    }
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
    if (!isLoading.value && currentRecords.value.length > 0) {
      window.print();
    }
  };

  return {
    selectedRecordIds,
    currentRecords,
    isLoading,
    isSettingPanelShow,
    settingList,
    init,
    selectRecord,
    handlePrint,
    handleSetting,
    handleSettingListUpdate
  };
};

export default usePrint;
