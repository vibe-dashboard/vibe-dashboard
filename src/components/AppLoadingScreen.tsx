type AppLoadingScreenProps = {
  className?: string;
  connectionErrorCallback?: () => void;
};

export function AppLoadingScreen({
  className = 'fixed inset-0 z-50',
  connectionErrorCallback,
}: AppLoadingScreenProps) {
  return (
    <div
      className={`${className} bg-neutral-950 flex items-center justify-center`}
    >
      <div className="flex flex-col items-center gap-3">
        {connectionErrorCallback ? (
          <>
            <p className="text-neutral-300 text-sm">Unable to connect to the server.</p>
            <button
              type="button"
              className="rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
              onClick={connectionErrorCallback}
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
            <p className="text-neutral-400 text-sm">Loading...</p>
          </>
        )}
      </div>
    </div>
  );
}
