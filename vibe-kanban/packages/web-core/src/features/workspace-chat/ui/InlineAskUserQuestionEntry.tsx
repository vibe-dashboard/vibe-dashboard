import { useCallback, useEffect, useRef, useState } from 'react';
import type { AskUserQuestionItem, QuestionAnswer } from 'shared/types';
import {
  AskUserQuestionBanner,
  type AskUserQuestionBannerHandle,
} from '@vibe/ui/components/AskUserQuestionBanner';
import { Button } from '@vibe/ui/components/Button';
import WYSIWYGEditor from '@/shared/components/WYSIWYGEditor';
import { useApprovalMutation } from '../model/hooks/useApprovalMutation';
import { useApprovals } from '@/shared/hooks/useApprovals';

interface InlineAskUserQuestionEntryProps {
  approvalId: string;
  executionProcessId: string;
  questions: AskUserQuestionItem[];
}

export function InlineAskUserQuestionEntry({
  approvalId,
  executionProcessId,
  questions,
}: InlineAskUserQuestionEntryProps) {
  const bannerRef = useRef<AskUserQuestionBannerHandle>(null);
  const submittingRef = useRef(false);
  const [customAnswer, setCustomAnswer] = useState('');
  const [nowTs, setNowTs] = useState(() => Date.now());
  const { answerAsync, isAnswering, answerError } = useApprovalMutation();
  const { getPendingById } = useApprovals();
  const approvalInfo = getPendingById(approvalId);
  const timeoutAtMs = approvalInfo
    ? new Date(approvalInfo.timeout_at).getTime()
    : Number.NaN;
  const isMetadataReady = approvalInfo !== null;
  const isTimedOut = Number.isFinite(timeoutAtMs) && nowTs > timeoutAtMs;

  useEffect(() => {
    if (!Number.isFinite(timeoutAtMs)) return;
    const delay = Math.max(timeoutAtMs - Date.now(), 0);
    const timer = setTimeout(() => setNowTs(Date.now()), delay + 10);
    return () => clearTimeout(timer);
  }, [timeoutAtMs]);

  const handleSubmitAnswers = useCallback(
    async (answers: QuestionAnswer[]) => {
      if (submittingRef.current) {
        throw new Error('Answer submission already in progress');
      }
      if (!isMetadataReady) {
        throw new Error('Approval metadata is still loading');
      }
      if (isTimedOut) {
        throw new Error('Approval timed out');
      }
      submittingRef.current = true;
      try {
        await answerAsync({ approvalId, executionProcessId, answers });
      } finally {
        submittingRef.current = false;
      }
    },
    [answerAsync, approvalId, executionProcessId, isMetadataReady, isTimedOut]
  );

  const handleSubmitCustomAnswer = useCallback(() => {
    const value = customAnswer.trim();
    if (!value || isAnswering || !isMetadataReady || isTimedOut) return;
    void bannerRef.current
      ?.submitCustomAnswer(value)
      .then((submitted) => {
        if (submitted) setCustomAnswer('');
      })
      .catch(() => undefined);
  }, [customAnswer, isAnswering, isMetadataReady, isTimedOut]);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-primary">
      <AskUserQuestionBanner
        ref={bannerRef}
        questions={questions}
        onSubmitAnswers={handleSubmitAnswers}
        isSubmitting={isAnswering}
        isTimedOut={!isMetadataReady || isTimedOut}
        error={answerError?.message ?? null}
      />
      <div className="flex flex-col gap-base p-double">
        <WYSIWYGEditor
          value={customAnswer}
          onChange={setCustomAnswer}
          onCmdEnter={handleSubmitCustomAnswer}
          disabled={isAnswering || !isMetadataReady || isTimedOut}
          placeholder="Type a custom answer…"
          className="min-h-[72px]"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleSubmitCustomAnswer}
            disabled={
              !customAnswer.trim() ||
              isAnswering ||
              !isMetadataReady ||
              isTimedOut
            }
          >
            Answer
          </Button>
        </div>
      </div>
    </div>
  );
}
