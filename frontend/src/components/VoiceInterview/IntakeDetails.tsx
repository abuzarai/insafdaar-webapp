import React, { useId } from "react";
import { Pencil } from "lucide-react";

export type ReviewedData = { issue_summary: string; primary_language: string; legal_domain: string;
  facts: Record<string, string | null>; key_entities: Record<string, string[]> };
export type EditTarget = "all" | "summary" | "settings" | `fact:${string}` | `entity:${string}`;
const domains = ["family_law", "property_law", "criminal_law", "civil_law", "labor_law", "corporate_law", "other"];
const factLabels: Record<string, string> = { alias_name: "Preferred name", issue_category: "Issue type", issue_description: "What happened", timeline: "Timeline", parties: "People involved", location: "Location", financial_impact: "Financial impact", previous_action: "Steps already taken", urgency: "Urgency", documentation: "Documents", desired_outcome: "Desired outcome" };
const entityLabels: Record<string, string> = { parties: "People", locations: "Places", dates: "Dates", amounts: "Amounts" };
const urLabels: Record<string, string> = { alias_name: "پسندیدہ نام", issue_category: "معاملے کی نوعیت", issue_description: "کیا ہوا", timeline: "واقعات کی ترتیب", parties: "متعلقہ افراد", location: "جگہ", financial_impact: "مالی اثر", previous_action: "پہلے کیے گئے اقدامات", urgency: "فوری ضرورت", documentation: "دستاویزات", desired_outcome: "مطلوبہ نتیجہ", locations: "مقامات", dates: "تاریخیں", amounts: "رقم" };
const supplied = (value: string | null | undefined): value is string => !!value?.trim();

export function reviewedTextErrors(data: ReviewedData) {
  const errors: Record<string, { count: number; limit: number }> = {};
  const check = (key: string, values: (string | null)[], limit: number) => {
    const count = values.reduce((longest, value) => Math.max(longest, Array.from(value ?? "").length), 0);
    if (count > limit) errors[key] = { count, limit };
  };
  check("summary", [data.issue_summary], 4096);
  Object.entries(data.facts).forEach(([key, value]) => check(`fact:${key}`, [value], 2048));
  Object.entries(data.key_entities).forEach(([key, values]) => check(`entity:${key}`, values, 4096));
  return errors;
}

// These are UI-language strings, independent of the interview's spoken language.
export const intakeCopy = (urdu: boolean) => urdu ? {
  story: "اپنی بات بتائیں", review: "اپنا کیس دیکھیں", find: "وکیل تلاش کریں", progress: "آپ کی پیش رفت",
  account: "آپ کی بات", important: "اہم تفصیلات", additional: "مزید اور اختیاری تفصیلات", missing: "یہ تفصیلات فراہم نہیں کی گئیں۔ اگر چاہیں تو شامل کر سکتے ہیں؛ نامعلوم بات کا اندازہ نہ لگائیں۔",
  edit: "تفصیلات درست کریں", editField: "درست کریں", add: "شامل کریں", notProvided: "فراہم نہیں کیا گیا", none: "کوئی تفصیل فراہم نہیں کی گئی", noSummary: "خلاصہ فراہم نہیں کیا گیا۔",
  summary: "معاملے کا خلاصہ", language: "پسندیدہ زبان", domain: "مجوزہ قانونی شعبہ — قانونی تصدیق نہیں", settings: "زبان اور مجوزہ قانونی شعبہ",
  facts: "تفصیلات — نامعلوم بات خالی چھوڑیں", entities: "مزید متعلقہ معلومات — ہر سطر میں ایک، اختیاری",
  confirm: "تصدیق کریں اور وکیل تلاش کریں", confirmHelp: "تصدیق سے ان تفصیلات کی بنیاد پر وکیل تلاش کیے جائیں گے۔ اس سے کوئی وکیل مقرر نہیں ہوتا اور نہ فیس طے ہوتی ہے۔",
  save: "تبدیلیاں محفوظ کریں", cancel: "منسوخ", editHelp: "محفوظ کرنے سے آپ جائزے پر واپس آئیں گے؛ کیس جمع نہیں ہوگا۔",
  reviewHelp: "محفوظ تفصیلات غور سے دیکھیں۔ حالیہ بات رہ سکتی ہے۔ یہ قانونی مشورہ نہیں۔",
  preparing: "آپ کے جائزے کے لیے کیس تیار ہو رہا ہے", preparingHelp: "تفصیلات ترتیب دی جا رہی ہیں۔ حالیہ بات رہ سکتی ہے؛ وکیل تلاش کرنے سے پہلے آپ جائزہ لیں گے۔",
  speak: "اپنا قانونی معاملہ اردو، انگریزی یا دونوں زبانوں میں بتائیں۔ وکیل تلاش کرنے سے پہلے آپ خلاصے کا جائزہ لے سکیں گے۔",
  consent: "انٹرویو شروع کرنے سے آپ اپنی آواز اور کیس کی معلومات گوگل جیمنائی کو صوتی کارروائی کے لیے بھیجنے کی اجازت دیتے ہیں۔ اصل خودکار متن صرف آپ کے کلائنٹ اکاؤنٹ کے لیے کیس میں محفوظ ہوگا، اور انٹرویو ختم ہونے کے ۹۰ دن بعد دستیاب نہیں رہے گا۔ یہ نظرثانی شدہ کیس کے حقائق، مصدقہ ثبوت یا مکمل آڈیو ریکارڈ نہیں ہے؛ حالیہ گفتگو چھوٹ سکتی ہے۔",
  stopNow: "ابھی روکیں", stop: "روکیں", stopHelp: "مائیک اور آواز فوراً بند ہوں گے۔ غیر محفوظ کام ضائع ہو سکتا ہے۔ پہلے سے جاری محفوظ کرنے کا عمل پھر بھی مکمل ہو سکتا ہے۔",
  newInterview: "نئی گفتگو شروع کریں", restartTitle: "نئی گفتگو شروع کریں؟", confirmRestart: "نئی گفتگو شروع کریں", keepSummary: "موجودہ خلاصہ رکھیں", reviewSaved: "محفوظ خلاصہ دیکھیں", checkAvailability: "دستیابی دیکھیں", continueCase: "اپنا کیس جاری رکھیں",
  restartHelp: "نیا خلاصہ تیار ہونے تک آپ کا موجودہ خلاصہ محفوظ رہے گا۔ جمع کرنے سے پہلے آپ نئے خلاصے کا جائزہ لیں گے۔",
  restartNoSummary: "آپ اسی کیس کے لیے نئی گفتگو شروع کریں گے۔ جمع کرنے سے پہلے آپ خلاصے کا جائزہ لے سکیں گے۔",
  start: "گفتگو شروع کریں", end: "گفتگو ختم کریں", ready: "بتائیں کیا ہوا", connected: "آپ کی صوتی گفتگو", editTitle: "اپنی تفصیلات درست کریں", reviewTitle: "اپنا کیس دیکھیں", submitted: "آپ کا کیس جمع ہو گیا ہے",
} : {
  story: "Tell your story", review: "Review your case", find: "Find a lawyer", progress: "Your progress",
  account: "Case summary", important: "Key details", additional: "More details", missing: "Add any details you know. Leave the rest blank.",
  edit: "Make changes", editField: "Edit", add: "Add", notProvided: "Not provided", none: "None provided", noSummary: "No summary provided.",
  summary: "Issue summary", language: "Preferred language", domain: "Suggested area of law", settings: "Language and legal area",
  facts: "Case details (leave unknown details blank)", entities: "Related information (one item per line, optional)",
  confirm: "Confirm & find a lawyer", confirmHelp: "Confirming approves these details for lawyer matching. It does not appoint a lawyer or commit you to a fee.",
  save: "Save changes", cancel: "Cancel", editHelp: "Saving returns you to review. It won’t submit your case.",
  reviewHelp: "Check the summary and correct anything missing or inaccurate. This is not legal advice.",
  preparing: "Preparing your summary", preparingHelp: "You’ll be able to check the details before submitting your case.",
  speak: "Describe your legal issue in English, Urdu, or both. You can review the summary before finding a lawyer.",
  consent: "By choosing Start interview, you agree to send your audio and case details to Google Gemini for processing. Your automatic transcript is accessible only through your client account for 90 days after the interview ends. It may be incomplete and is not your reviewed case summary, certified evidence, or an audio recording.",
  stopNow: "Stop now", stop: "Stop", stopHelp: "Ends audio immediately. Unsaved details may be lost.",
  newInterview: "Start a new interview", restartTitle: "Start a new interview?", confirmRestart: "Start new interview", keepSummary: "Keep current summary", reviewSaved: "Review saved summary", checkAvailability: "Check availability", continueCase: "Continue your case",
  restartHelp: "Your current summary will stay saved until a new one is ready. You’ll review the new summary before submitting.",
  restartNoSummary: "You’ll start another interview for this case. You can review the summary before submitting.",
  start: "Start interview", end: "End interview", ready: "Tell us what happened", connected: "Tell us about your case", editTitle: "Edit your details", reviewTitle: "Review your case", submitted: "Your case has been submitted",
};

type DetailsProps = { data: ReviewedData; urdu: boolean; canEdit: boolean; expanded: boolean; onExpanded: (expanded: boolean) => void;
  onEdit: (target: EditTarget) => void };
export function IntakeDetails({ data, urdu, canEdit, expanded, onExpanded, onEdit }: DetailsProps) {
  const c = intakeCopy(urdu);
  const label = (key: string, labels: Record<string, string>) => (urdu && urLabels[key]) || labels[key] || key;
  const edit = (target: EditTarget, name: string, adding = false) => canEdit && <button type="button" className="intake-edit-link" data-edit-target={target} aria-label={`${adding ? c.add : c.editField} ${name}`} onClick={() => onEdit(target)}><Pencil size={14} aria-hidden="true" />{adding ? c.add : c.editField}</button>;
  // Hide only verbatim prose repetition in the compact view. Every stored value remains below.
  const facts = Object.entries(data.facts).filter(([, value]) => supplied(value) && !data.issue_summary.includes(value.trim()));
  const shownFacts = new Set(facts.map(([key]) => key));
  const visibleProse = [data.issue_summary, ...facts.map(([, value]) => value!)].map(v => v.trim());
  const entities = Object.entries(data.key_entities).map(([key, values]) => [key, values.filter(value => !visibleProse.some(prose => prose.includes(value.trim())))] as const).filter(([, values]) => values.length);
  const renderFact = (key: string, value: string | null) => <div key={key} className="intake-detail"><dt><span>{label(key, factLabels)}</span>{edit(`fact:${key}`, label(key, factLabels), !supplied(value))}</dt><dd dir="auto">{supplied(value) ? value : c.notProvided}</dd></div>;
  const renderEntity = (key: string, values: readonly string[], editable = true) => <div key={key} className="intake-detail"><dt><span>{label(key, entityLabels)}</span>{editable && edit(`entity:${key}`, label(key, entityLabels), !values.length)}</dt><dd>{values.length ? <ul>{values.map((value, index) => <li dir="auto" key={index}>{value}</li>)}</ul> : c.none}</dd></div>;
  return <>
    <section className="intake-account" aria-label={c.account}>
      <div className="intake-section-heading"><h4>{c.account}</h4>{edit("summary", c.summary)}</div>
      <div className="intake-summary" aria-label={c.summary} dir="auto">{supplied(data.issue_summary) ? data.issue_summary : c.noSummary}</div>
    </section>
    {!!(facts.length || entities.length) && <section aria-label={c.important}><h4>{c.important}</h4><dl className="intake-facts">{facts.map(([key, value]) => renderFact(key, value))}{entities.map(([key, values]) => renderEntity(key, values))}</dl></section>}
    <details className="intake-additional" open={expanded} onToggle={e => onExpanded(e.currentTarget.open)}>
      <summary>{c.additional}</summary>
      {Object.values(data.facts).some(value => !supplied(value)) && <p>{c.missing}</p>}
      <dl className="intake-facts">{Object.entries(data.facts).filter(([key]) => !shownFacts.has(key)).map(([key, value]) => renderFact(key, value))}</dl>
      <h4>{urdu ? "تمام متعلقہ معلومات" : "Related information"}</h4>
      <dl className="intake-facts">{Object.entries(data.key_entities).map(([key, values]) => renderEntity(key, values, !entities.some(([shown]) => shown === key)))}</dl>
      <div className="intake-section-heading"><h4>{c.settings}</h4>{edit("settings", c.settings)}</div>
      <dl className="intake-facts"><div><dt>{c.language}</dt><dd>{data.primary_language === "mixed" ? "Urdu / English mixed" : data.primary_language}</dd></div><div><dt>{c.domain}</dt><dd>{data.legal_domain.replace(/_/g, " ")}</dd></div></dl>
    </details>
  </>;
}

type EditorProps = { draft: ReviewedData; target: EditTarget; disabled: boolean; urdu: boolean; onChange: (data: ReviewedData) => void };
export function IntakeEditor({ draft, target, disabled, urdu, onChange }: EditorProps) {
  const c = intakeCopy(urdu);
  const id = useId();
  const errors = reviewedTextErrors(draft);
  const label = (key: string, labels: Record<string, string>) => (urdu && urLabels[key]) || labels[key] || key;
  const errorProps = (key: string) => ({ "aria-invalid": errors[key] ? true : undefined, "aria-describedby": errors[key] ? `${id}-${key}` : undefined });
  const errorMessage = (key: string) => errors[key] && <span id={`${id}-${key}`} role="alert">{urdu
    ? `اس تفصیل کو ${errors[key].limit} حروف تک مختصر کریں۔ ابھی ${errors[key].count} ہیں۔ آپ کا متن تبدیل نہیں کیا گیا۔`
    : `Shorten this to ${errors[key].limit} characters (currently ${errors[key].count}). Your text has not been changed.`}</span>;
  return <>
    <p>{c.editHelp}</p>
    {(target === "all" || target === "summary") && <label>{c.summary}<textarea dir="auto" aria-label={c.summary} {...errorProps("summary")} disabled={disabled} value={draft.issue_summary} onChange={e => onChange({ ...draft, issue_summary: e.target.value })} />{errorMessage("summary")}</label>}
    {(target === "all" || target === "settings") && <>
      <label>{c.language}<select disabled={disabled} value={draft.primary_language} onChange={e => onChange({ ...draft, primary_language: e.target.value })}><option value="english">English</option><option value="urdu">Urdu</option><option value="mixed">Urdu / English mixed</option></select></label>
      <label>{c.domain}<select disabled={disabled} value={draft.legal_domain} onChange={e => onChange({ ...draft, legal_domain: e.target.value })}>{domains.map(d => <option key={d} value={d}>{d === "other" ? "Other / unsure" : d.replace(/_/g, " ")}</option>)}</select></label>
    </>}
    {(target === "all" || target.startsWith("fact:")) && <fieldset disabled={disabled}><legend>{c.facts}</legend>{Object.entries(draft.facts).filter(([key]) => target === "all" || target === `fact:${key}`).map(([key, value]) => <label key={key}>{label(key, factLabels)}<textarea dir="auto" aria-label={label(key, factLabels)} {...errorProps(`fact:${key}`)} value={value ?? ""} onChange={e => onChange({ ...draft, facts: { ...draft.facts, [key]: e.target.value || null } })} />{errorMessage(`fact:${key}`)}</label>)}</fieldset>}
    {(target === "all" || target.startsWith("entity:")) && <fieldset disabled={disabled}><legend>{c.entities}</legend>{Object.entries(draft.key_entities).filter(([key]) => target === "all" || target === `entity:${key}`).map(([key, values]) => <label key={key}>{label(key, entityLabels)}<textarea dir="auto" aria-label={label(key, entityLabels)} {...errorProps(`entity:${key}`)} value={values.join("\n")} onChange={e => onChange({ ...draft, key_entities: { ...draft.key_entities, [key]: e.target.value.split("\n").filter(v => v.trim()) } })} />{errorMessage(`entity:${key}`)}</label>)}</fieldset>}
  </>;
}
