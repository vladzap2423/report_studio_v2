export default function Loading() {
  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <div className="flex items-center gap-3 text-sm text-gray-500">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-black"></div>
        Загрузка услуг...
      </div>
    </div>
  );
}