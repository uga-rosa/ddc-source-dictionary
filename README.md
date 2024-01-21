# ddc-source-dictionary

Dictionary source for ddc.vim.

How to load dictionaries:
- Create Trie in memory (Default).
- Local database using Deno KV (Need to set `param-databasePath`).
- Search by external command (e.g. `look`, `ripgrep`) each time (Need to set `param-externalCommand`).

# Example

```vim
call ddc#custom#patch_global(#{
      \ sources: [ 'dictionary' ],
      \ sourceOptions: #{
      \   dictionary: #{
      \     mark: '[Dict]',
      \   },
      \ },
      \ sourceParams: #{
      \   dictionary: #{
      \     paths: [ '/usr/share/dict/words' ],
      \     exactLength: 2,
      \     firstCaseInsensitive: v:true,
      \     showPath: v:true,
      \     documentCommand: [ 'wn', '${item.word}', '-over' ],
      \   },
      \ },
      \})
```

See [doc](./doc/ddc-source-dictionary.txt) for details.
