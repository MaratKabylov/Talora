import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_VALUES,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPE_VALUES,
  TEST_COMPETENCIES,
} from "@/lib/tests/builder-constants";
import type { BuilderQuestion } from "@/lib/tests/builder-data";

export function QuestionFields({
  defaultOrderIndex = 0,
  prefix,
  question,
}: {
  defaultOrderIndex?: number;
  prefix: string;
  question?: BuilderQuestion;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-text`}>Текст вопроса</Label>
        <Textarea
          defaultValue={question?.text ?? ""}
          id={`${prefix}-text`}
          name="questionText"
          placeholder="Сформулируйте вопрос кандидату"
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-type`}>Тип вопроса</Label>
          <Select
            defaultValue={question?.questionType ?? "single_choice"}
            id={`${prefix}-type`}
            name="questionType"
          >
            {QUESTION_TYPE_VALUES.map((value) => (
              <option key={value} value={value}>
                {QUESTION_TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-competency`}>Компетенция</Label>
          <Select
            defaultValue={question?.competencyKey ?? ""}
            id={`${prefix}-competency`}
            name="competencyKey"
          >
            <option value="">Не назначена</option>
            {TEST_COMPETENCIES.map((competency) => (
              <option key={competency.key} value={competency.key}>
                {competency.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-difficulty`}>Сложность</Label>
          <Select
            defaultValue={question?.difficulty ?? ""}
            id={`${prefix}-difficulty`}
            name="difficulty"
          >
            <option value="">Не указана</option>
            {DIFFICULTY_VALUES.map((value) => (
              <option key={value} value={value}>
                {DIFFICULTY_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-points`}>Макс. баллы</Label>
          <Input
            defaultValue={question?.points ?? 0}
            id={`${prefix}-points`}
            min="0"
            name="questionPoints"
            step="0.01"
            type="number"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-order`}>Порядок</Label>
          <Input
            defaultValue={question?.orderIndex ?? defaultOrderIndex}
            id={`${prefix}-order`}
            min="0"
            name="questionOrderIndex"
            required
            step="1"
            type="number"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-scale-min`}>Шкала: минимум</Label>
          <Input
            defaultValue={question?.scaleMin ?? 1}
            id={`${prefix}-scale-min`}
            min="1"
            name="scaleMin"
            step="1"
            type="number"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-scale-max`}>Шкала: максимум</Label>
          <Input
            defaultValue={question?.scaleMax ?? 5}
            id={`${prefix}-scale-max`}
            min="2"
            name="scaleMax"
            step="1"
            type="number"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-description`}>Пояснение</Label>
        <RichTextEditor
          defaultValue={question?.description ?? ""}
          id={`${prefix}-description`}
          name="questionDescription"
          placeholder="Дополнительный контекст вопроса"
        />
      </div>
    </div>
  );
}
