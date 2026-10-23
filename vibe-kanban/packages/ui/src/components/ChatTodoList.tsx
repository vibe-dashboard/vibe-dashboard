import { useTranslation } from 'react-i18next';
import { ListChecksIcon, CaretDownIcon } from '@phosphor-icons/react';
import { Circle, Check, CircleDot } from 'lucide-react';
import { cn } from '../lib/cn';

export interface TodoItemLike {
  content: string;
  status?: string | null;
}

interface ChatTodoListProps {
  todos: TodoItemLike[];
  expanded?: boolean;
  onToggle?: () => void;
}

function getStatusIcon(status?: string | null) {
  const s = (status || '').toLowerCase();
  if (s === 'completed')
    return <Check aria-hidden className="h-4 w-4 text-success" />;
  if (s === 'in_progress' || s === 'in-progress')
    return <CircleDot aria-hidden className="h-4 w-4 text-primary" />;
  if (s === 'cancelled')
    return <Circle aria-hidden className="h-4 w-4 text-default-500" />;
  return <Circle aria-hidden className="h-4 w-4 text-default-500" />;
}

export function ChatTodoList({ todos, expanded, onToggle }: ChatTodoListProps) {
  const { t } = useTranslation('tasks');

  return (
    <div className="text-sm">
      <div
        className="flex items-center gap-base text-default-500 cursor-pointer"
        onClick={onToggle}
        role="button"
      >
        <ListChecksIcon className="shrink-0 size-icon-base" />
        <span className="flex-1">{t('conversation.updatedTodos')}</span>
        <CaretDownIcon
          className={cn(
            'shrink-0 size-icon-base transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </div>
      {expanded && todos.length > 0 && (
        <ul className="pt-base ml-6 [&>li+li]:pt-1">
          {todos.map((todo, index) => (
            <li
              key={`${todo.content}-${index}`}
              className="flex items-start gap-2"
            >
              <span className="pt-0.5 h-4 w-4 flex items-center justify-center shrink-0">
                {getStatusIcon(todo.status)}
              </span>
              <span className="leading-5 break-words">
                {todo.status?.toLowerCase() === 'cancelled' ? (
                  <s className="text-default-500">{todo.content}</s>
                ) : (
                  todo.content
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
