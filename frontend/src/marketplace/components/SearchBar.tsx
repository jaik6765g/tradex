import React, { useState } from 'react';
import {
  Filter,
  Search,
  X,
} from 'lucide-react';

export default function SearchBar() {
  const [search, setSearch] = useState('');

  return (
    <div className="flex items-center gap-3 mx-5 my-4">
      <div className="flex-1 flex items-center bg-white rounded-full px-4 py-3 border border-[#E5E7EB] gap-2.5">
        <Search
          size={20}
          color="#9CA3AF"
          className="shrink-0"
        />

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search assets, collections or games..."
          placeholder-color="#9CA3AF"
          className="flex-1 outline-none text-sm text-[#111827] bg-transparent min-w-0"
        />

        {search && (
          <button onClick={() => setSearch('')}>
            <X size={17} color="#9CA3AF" />
          </button>
        )}
      </div>

      <button className="flex items-center bg-white px-4 py-3 rounded-full border border-[#E5E7EB] gap-1.5 hover:bg-[#F9FAFB]">
        <Filter size={16} color="#374151" />

        <span className="text-sm font-semibold text-[#374151]">
          Filter
        </span>
      </button>
    </div>
  );
}
