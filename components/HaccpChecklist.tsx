import React from 'react';
import {StaffChecklistForCompany,HaccpChecklistForCompany} from '../src/features/haccp/ui/HaccpChecklistShells';

export {PersonalHygieneTemplateEditor,TempZoneTemplateEditor,SanitationTemplateEditor} from '../src/features/haccp/ui/ChecklistTemplateEditors';
export {PersonalHygieneForm} from '../src/features/haccp/ui/PersonalHygieneForm';
export {SanitationForm} from '../src/features/haccp/ui/SanitationForm';
export {TempForm} from '../src/features/haccp/ui/TempForm';

// 회사가 바뀌면 이전 회사의 초안·템플릿·구독을 함께 비운다.
export const StaffChecklistView = (props: React.ComponentProps<typeof StaffChecklistForCompany>) =>
  <StaffChecklistForCompany key={props.companyId} {...props} />;
const HaccpChecklist = (props: React.ComponentProps<typeof HaccpChecklistForCompany>) =>
  <HaccpChecklistForCompany key={props.companyId} {...props} />;
export default HaccpChecklist;
