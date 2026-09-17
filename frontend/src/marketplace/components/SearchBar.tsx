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
      <div className="flex-1 flex items-center bg-[#15161C] rounded-full px-4 py-3 border border-[#292B33] gap-2.5">
        <Search
          size={20}
          color="#A1A4AE"
          className="shrink-0"
        />

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search assets, collections or games..."
          placeholder-color="#A1A4AE"
          className="flex-1 outline-none text-sm text-[#F5F5F7] bg-transparent min-w-0"
        />

        {search && (
          <button onClick={() => setSearch('')}>
            <X size={17} color="#A1A4AE" />
          </button>
        )}
      </div>

      <button className="flex items-center bg-[#15161C] px-4 py-3 rounded-full border border-[#292B33] gap-1.5 hover:bg-[#15161C]">
        <Filter size={16} color="#E4E5E8" />

        <span className="text-sm font-semibold text-[#E4E5E8]">
          Filter
        </span>
      </button>
    </div>
  );
}
